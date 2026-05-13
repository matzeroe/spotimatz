from __future__ import annotations

import argparse


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--output-path", required=True)
    parser.add_argument("--services", required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    from pathlib import Path

    from .spotiflac_adapter import run_download

    run_download(
        args.url,
        Path(args.output_dir),
        Path(args.output_path),
        [service for service in args.services.split(",") if service],
    )


if __name__ == "__main__":
    main()
