#!/usr/bin/env python3
"""
Generate production-validation-reference.json from the existing
validation-reference-10-leads-13-verticals.json.

Creates a flat array of 130 objects (10 leads x 13 verticals), each containing
the full enrichment data and the expected v5.0 scoring response.

Source of truth: scores_by_vertical (all v5.0 scores).
"""

import json
import sys
from datetime import datetime

INPUT_FILE = "validation-reference-10-leads-13-verticals.json"
OUTPUT_FILE = "production-validation-reference.json"

VERTICALS = [
    "solar", "roofing", "windows", "hvac", "siding", "gutters",
    "painting", "plumbing", "bathroom_remodel", "kitchen_remodel",
    "flooring", "insurance", "mortgage"
]

# Spot-check expectations: (lead_id, vertical) -> (tier, score)
SPOT_CHECKS = {
    ("L1", "solar"): ("Gold", 78),
    ("L5", "solar"): ("Reject", 15),
    ("L1", "hvac"): ("Gold", 78),
    ("L5", "kitchen_remodel"): ("Reject", 5),
    ("L3", "plumbing"): ("Gold", 78),
    ("L10", "windows"): ("Gold", 95),
}


def main():
    with open(INPUT_FILE, "r") as f:
        data = json.load(f)

    # Build lead lookup: lead_id -> {name, enrichment_summary}
    leads_by_id = {}
    for lead in data["leads"]:
        leads_by_id[lead["lead_id"]] = {
            "name": lead["name"],
            "enrichment_summary": lead["enrichment_summary"],
        }

    # Build output array from scores_by_vertical
    entries = []
    scores_by_vertical = data["scores_by_vertical"]

    for vertical in VERTICALS:
        if vertical not in scores_by_vertical:
            print(f"ERROR: vertical '{vertical}' not found in scores_by_vertical")
            sys.exit(1)

        for score_entry in scores_by_vertical[vertical]:
            lead_id = score_entry["lead_id"]
            lead_info = leads_by_id.get(lead_id)
            if not lead_info:
                print(f"ERROR: lead_id '{lead_id}' not found in leads array")
                sys.exit(1)

            entry = {
                "lead_id": lead_id,
                "lead_name": score_entry["lead_name"],
                "vertical": vertical,
                "prompt_version": "v5.0",
                "enrichment_data": lead_info["enrichment_summary"],
                "expected_response": {
                    "tier": score_entry["tier"],
                    "score": score_entry["score"],
                    "confidence": score_entry["confidence"],
                    "reasons": score_entry["reasons"],
                    "concerns": score_entry["concerns"],
                },
            }
            entries.append(entry)

    # Verify count
    expected_count = 130
    actual_count = len(entries)
    if actual_count != expected_count:
        print(f"ERROR: Expected {expected_count} entries, got {actual_count}")
        sys.exit(1)

    print(f"Generated {actual_count} entries (10 leads x 13 verticals)")

    # Run spot-checks
    entry_lookup = {(e["lead_id"], e["vertical"]): e for e in entries}
    all_passed = True
    for (lid, vert), (exp_tier, exp_score) in SPOT_CHECKS.items():
        entry = entry_lookup.get((lid, vert))
        if not entry:
            print(f"SPOT-CHECK FAIL: {lid} {vert} not found")
            all_passed = False
            continue
        actual_tier = entry["expected_response"]["tier"]
        actual_score = entry["expected_response"]["score"]
        status = "PASS" if (actual_tier == exp_tier and actual_score == exp_score) else "FAIL"
        if status == "FAIL":
            all_passed = False
        print(f"  {status}: {lid} {vert} -> {actual_tier} {actual_score} (expected {exp_tier} {exp_score})")

    if not all_passed:
        print("\nERROR: Some spot-checks failed!")
        sys.exit(1)

    print("\nAll spot-checks passed.")

    # Build final output with metadata
    output = {
        "_metadata": {
            "generated": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
            "source_file": "validation-reference-10-leads-13-verticals.json",
            "purpose": "Production validation reference for GreenWatt lead scoring Lambda. Each entry contains the full enrichment data for a lead and the expected scoring response (tier, score, confidence, reasons, concerns) for a specific vertical. Developers should run each lead's enrichment_data through the scoring Lambda for the given vertical and compare the output against expected_response.",
            "usage_instructions": {
                "step_1": "For each entry, POST enrichment_data to the scoring Lambda with the specified vertical.",
                "step_2": "Compare the Lambda response (tier, score, confidence) against expected_response.",
                "step_3": "Tier and score must match exactly (temp=0 deterministic). Reasons/concerns are approximate -- check semantic equivalence, not exact string match.",
                "step_4": "If any tier or score mismatches, investigate prompt drift or enrichment parsing changes before deploying."
            },
            "prompt_version": "v5.0 (hybrid: v4.2 standalone for solar/roofing/windows, BASE_PROMPT + VERTICAL_CONTEXTS for 10 new verticals)",
            "model": "claude-sonnet-4-20250514",
            "temperature": 0,
            "total_entries": actual_count,
            "leads_count": 10,
            "verticals_count": 13,
            "verticals": VERTICALS,
            "validated_verticals": ["solar", "roofing", "windows"],
            "unvalidated_verticals": ["hvac", "siding", "gutters", "painting", "plumbing", "bathroom_remodel", "kitchen_remodel", "flooring", "insurance", "mortgage"],
            "notes": "Solar, roofing, and windows scores are validated against production data (1,231 / 320 / 198 leads respectively). The other 10 verticals use research-based conservative defaults and are marked [UNVALIDATED] -- collect dispo data before trusting these thresholds."
        },
        "entries": entries,
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\nWrote {OUTPUT_FILE} ({actual_count} entries)")

    # Final verification: re-read and count
    with open(OUTPUT_FILE, "r") as f:
        verify = json.load(f)
    verify_count = len(verify["entries"])
    print(f"Verification: re-read file has {verify_count} entries")

    # Show a sample entry
    print("\nSample entry (L1 solar):")
    print(json.dumps(verify["entries"][0], indent=2))


if __name__ == "__main__":
    main()
