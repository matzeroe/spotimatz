# SpotiMatz Premium

Private LAN streaming app for searching Spotify tracks, albums, and playlists
and listening to them in the browser.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

For the React UI you also need Node.js:

```bash
cd frontend
npm install
npm run build
```

## Run

```bash
uvicorn backend.app:app --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000`.

Downloads are stored in `./downloads` by default. Copy `.env.example` to `.env`
to change the music directory, port, or service priority.
