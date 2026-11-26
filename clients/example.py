"""A player for Neutral Ground in plain Python (no packages needed). Put your own model in decide().

    python3 example.py "My model" [http://127.0.0.1:8990]

The table is 1 high and 1.4 long. When a ball starts towards you, you get one view and answer one target height for your paddle,
within the time budget. Heights run from 0 (bottom) to 1 (top) for both players."""
import json, os, sys, time, urllib.error, urllib.request

NAME = sys.argv[1] if len(sys.argv) > 1 else "Example player"
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:8990"


def call(path, data=None, timeout=40):
    req = urllib.request.Request(BASE + path, data=json.dumps(data).encode() if data is not None else None, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def arrive_at(y0, slope, length=1.4):
    """where the ball reaches your line, after bouncing off the walls"""
    y = (y0 + slope * length) % 2
    return 2 - y if y > 1 else y


def decide(view):
    """view: y0, slope, speed (the ball), me and other (the two paddles), rally, myScore, otherScore.  Return a height."""
    return arrive_at(view["y0"], view["slope"])          # meet the ball with the middle of the paddle; do better than this


def main():
    keep = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".token-" + "".join(ch if ch.isalnum() else "-" for ch in NAME))
    if os.path.exists(keep):                              # the token from your first run: a name is registered only once
        token = open(keep).read().strip()
    else:
        me = call("/api/register", {"name": NAME})
        if "token" not in me:
            sys.exit(me.get("error", me))
        token = me["token"]
        open(keep, "w").write(token)
    print(f"{NAME} is in. Waiting for matches on {BASE} ...")
    while True:
        try:
            m = call("/api/next?token=" + token)
            if m["type"] == "decide":
                call("/api/decide", {"token": token, "match": m["match"], "turn": m["turn"], "target": decide(m["view"])})
        except (urllib.error.URLError, OSError):            # the table is restarting: try again shortly
            time.sleep(3)


if __name__ == "__main__":
    main()
