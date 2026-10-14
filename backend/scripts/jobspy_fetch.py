#!/usr/bin/env python3
"""Fetch job listings with JobSpy (github.com/speedyapply/JobSpy).

Reads one JSON object on stdin:
  {"sites": ["indeed", "linkedin"], "queries": ["software engineer intern", ...],
   "location": "United States", "country": "USA", "results_wanted": 50, "hours_old": 72}
Writes one JSON object on stdout:
  {"jobs": [{site, query, title, company, location, job_url, job_url_direct,
             date_posted, min_amount, max_amount, interval, currency, is_remote}],
   "errors": [{site, query, error}]}
Runs inside the dedicated virtualenv (~/outreach/.venv-jobspy); called by
services/jobSpy.js. Never prints anything else to stdout.
"""
import json
import math
import sys

FIELDS = ["title", "company", "location", "job_url", "job_url_direct", "date_posted",
          "min_amount", "max_amount", "interval", "currency", "is_remote", "description"]


def clean(value):
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    text = str(value)
    return None if text in ("nan", "NaN", "None", "") else value


def main():
    from jobspy import scrape_jobs  # imported here so a bad install is reported as JSON

    req = json.load(sys.stdin)
    jobs, errors = [], []
    for site in req.get("sites", ["indeed", "linkedin"]):
        for query in req.get("queries", []):
            try:
                df = scrape_jobs(
                    site_name=[site],
                    search_term=query,
                    location=req.get("location", "United States"),
                    results_wanted=int(req.get("results_wanted", 50)),
                    hours_old=int(req.get("hours_old", 72)),
                    country_indeed=req.get("country", "USA"),
                    verbose=0,
                )
                for row in df.to_dict("records"):
                    item = {k: clean(row.get(k)) for k in FIELDS}
                    item["site"] = site
                    item["query"] = query
                    jobs.append(item)
            except Exception as exc:  # one site/query failing must not lose the rest
                errors.append({"site": site, "query": query, "error": str(exc)[:300]})
    json.dump({"jobs": jobs, "errors": errors}, sys.stdout, default=str)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        json.dump({"jobs": [], "errors": [{"site": "*", "query": "*", "error": str(exc)[:300]}]}, sys.stdout)
