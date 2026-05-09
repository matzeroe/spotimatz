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
    from SpotiFLAC import SpotiFLAC

    SpotiFLAC(
        args.url,
        args.output_dir,
        services=[service for service in args.services.split(",") if service],
        filename_format="{title} - {artist}",
        use_track_numbers=False,
        use_artist_subfolders=False,
        use_album_subfolders=False,
        loop=None,
        output_path=args.output_path,
    )


if __name__ == "__main__":
    main()
