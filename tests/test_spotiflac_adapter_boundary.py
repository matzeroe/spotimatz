from pathlib import Path


def test_spotiflac_imports_are_isolated_to_adapter() -> None:
    backend_dir = Path(__file__).resolve().parents[1] / "backend"
    forbidden = ("from SpotiFLAC", "import SpotiFLAC", "SpotiFLAC.")

    offenders = []
    for path in backend_dir.glob("*.py"):
        if path.name == "spotiflac_adapter.py":
            continue
        text = path.read_text(encoding="utf-8")
        if any(token in text for token in forbidden):
            offenders.append(path.name)

    assert offenders == []
