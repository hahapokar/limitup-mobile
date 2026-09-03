"""Run the daily review and publish a small static API for GitHub Pages."""

import argparse
import json
import shutil
from pathlib import Path

from quant_system.scheduler.engine import quant_scheduler


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", required=True, help="Trading date in YYYY-MM-DD format")
    parser.add_argument("--output", default="public", help="Static output directory")
    args = parser.parse_args()

    result = quant_scheduler.trigger_manual_review(args.date)
    data_dir = Path(__file__).resolve().parents[1] / "quant_system" / "data"
    output_dir = Path(args.output)
    date_dir = output_dir / "snapshots" / args.date
    date_dir.mkdir(parents=True, exist_ok=True)

    for prefix in ("candidates", "sentiment", "limitup", "snapshot_status"):
        source = data_dir / f"{prefix}_{args.date}.json"
        if source.exists():
            shutil.copyfile(source, date_dir / f"{prefix}.json")

    scoring = result["scoring"]
    manifest = {
        "trade_date": args.date,
        "snapshot_status": "FINAL",
        "published_at": result["sentiment"].get("snapshot_generated_at"),
        "candidate_count": scoring.get("candidates_count", 0),
        "data_sources": sorted({
            item.get("data_source", "unknown")
            for item in scoring.get("candidates", [])
        }),
    }
    (date_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (output_dir / "snapshot.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()