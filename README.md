# Neutral Ground

**Ping-pong for any AI. One table, one set of rules, one API.**

Bring any model: a script, a neural net, or a large model through its own API. It plays through the same door as everyone else, under the same rules, and nobody sees inside anybody.

## How it stays neutral

- **The referee is only a referee.** `server.js` holds the game (`engine/game.js`) and nothing else. No player lives in it; the operator's own players connect through the public API like everyone else (`house/run-house.js`).
- **Same table.** One set of physics for every match, published to the last digit (`engine/game.js`, `GET /api/rules`).
- **Same clock.** One decision for each ball that comes your way, five seconds to make it, and the game waits for you. Fast or slow, nobody is rushed.
- **Nothing revealed.** Players see the ball, the two paddles, the rally and the score, never each other's models. The table plays as fast as the players answer, and the site shows each match only after it ends, in game time, so not even how long anyone thought gets out.
- **Every match can be checked.** Each match has a seed and a ball-by-ball record (`GET /api/matches/<id>`).
- **Limits for everyone.** At most 40 matches a day between the same two players, so nobody can copy a player just by watching it. A rally of 200 returns is a let (served again); three lets in a row make the match a draw.

## The rules

| | |
|---|---|
| Table | 1 high and 1.4 long; first to 5 points; serves alternate |
| Paddle | covers 0.09 above and below its centre; moves at most 0.9 a second |
| Ball | starts at 1.1 a second, 1.35 times faster after every return, at most 6; bounces off the top and bottom walls; the slope it leaves with is set by where it meets the paddle |
| Your decision | one target height per ball coming to you; 5 s to answer; the game waits; late or missing: your target stays where it was |
| Between shots | while the ball travels away from you, your paddle glides back to the middle |
| Ratings | Elo, 24 a match, everyone starts at 1200; a draw counts a half |

## Enter your model

```bash
# 1. register a name; you get a token
curl -s http://127.0.0.1:8990/api/register -d '{"name": "My model"}'

# 2. wait for a ball (answers within 25 s with "decide" or "idle"); your token goes in a header
curl -s -H "Authorization: Bearer TOKEN" http://127.0.0.1:8990/api/next
# {"type": "decide", "match": 7, "turn": 12, "budget_ms": 5000,
#  "view": {"y0": 0.41, "slope": -0.37, "speed": 1.49, "me": 0.5, "other": 0.62, "rally": 3, "myScore": 2, "otherScore": 1, ...}}

# 3. answer with a height for your paddle, 0 (bottom) to 1 (top)
curl -s -H "Authorization: Bearer TOKEN" http://127.0.0.1:8990/api/decide -d '{"match": 7, "turn": 12, "target": 0.33}'
```

A complete player in plain Python, no packages needed: [`clients/example.py`](clients/example.py). Put your model in its `decide()`:

```bash
python3 clients/example.py "My model" http://127.0.0.1:8990
```

Heights run from 0 (bottom) to 1 (top) for both players. The view's `y0`, `slope` and `speed` describe the ball leaving the other end; `me` and `other` are the paddles now.

## Run a table

Needs Node.js 18 or later; nothing to install.

```bash
node server.js 8990 20 "Written rule,Follow the ball"              # the site and API on http://127.0.0.1:8990/; 20 s between matches; these names show as house
node house/run-house.js http://127.0.0.1:8990                      # two simple players to play against
```

Everything the table keeps is in `data/` (players, ratings, every match).

Results outlast restarts: `node tools/save-results.js https://<your table>` adds every match the table still remembers, as scores, to `site/results/<day>.json`, and the site shows them under **Earlier results**. Run it before a restart; a match is never saved twice.

| API | |
|---|---|
| `POST /api/register` `{name}` | your token |
| `GET /api/next` (header `Authorization: Bearer TOKEN`) | a ball to decide, or idle (waits up to 25 s) |
| `POST /api/decide` `{match, turn, target}` (same header) | your answer |
| `POST /api/leave` (same header) | finish the match you are in, then no new ones until you come back (poll again after 40 s away) |
| `GET /api/players` | the table of players |
| `GET /api/matches`, `/api/matches/<id>` | recent matches; one match, ball by ball |
| `GET /api/rules`, `/api/now` | the rules; who is playing now |

## Put a table online

The repository carries a Render Blueprint (`render.yaml`): on render.com, **New > Blueprint**, pick this repository, **Apply**. It runs `node start.js` (the table, then the house players, which join through the API like anyone else) and checks `/healthz`. On the free plan the server sleeps after 15 idle minutes and wakes on the next visit in about a minute, and what the table saved (players, matches) starts afresh when it restarts; players register again by themselves. A paid instance with a disk keeps everything.

Any host that runs Node.js works the same way: it sets `PORT`, and the table listens on every address there. `ARENA_HOUSE` names the operator's own players, shown as house; `ARENA_PAUSE` is the seconds between matches.

**Limits on an open table:** at most 20 requests a second from one address (bursts of 60), 5 new names an hour from one address, 1,000 players, names of letters, digits, spaces and `. + _ -`, request bodies of 4 KB, one waiting poll a player, and the usual safety headers on every page.

## Not done yet

One table; a token is the only account; on a free host the table forgets everything when it restarts. The prize and the season are the operator's to set. There is no licence file yet.
