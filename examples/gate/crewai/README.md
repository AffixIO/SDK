# CrewAI (Python)

The `affixio` SDK is Node.js. CrewAI is Python, so there is no in-process integration.
Two options that work today:

1. Run one of the HTTP starters in `templates/` (Express or Fastify) and call it from a
   CrewAI tool before doing the real work:

```python
import requests
from crewai.tools import tool

@tool("search_web")
def search_web(query: str) -> str:
    """Search the web."""
    r = requests.post("http://127.0.0.1:3000/tools/search", json={"query": query, "cost": 0.5}, timeout=5)
    if r.status_code != 200:
        return f"denied: {r.json().get('reason')}"
    return r.text
```

2. The npm package also ships `python/affixio_client.py`, a client for the hosted API.

This Python snippet was not run in CI. Only the Node HTTP starter it calls was tested.
