"""Cache dated TWSE and TPEx public reports for monthly history import."""
import argparse
import concurrent.futures
import datetime as dt
import json
from pathlib import Path
import urllib.request
from daily import market_urls

def fetch(url, timeout):
    req = urllib.request.Request(url, headers={'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.load(res)

def monthly_dates(month, finish, target):
    key = month.strftime('%Y%m01')
    file = target / (key + '-calendar.json')
    try:
        if file.exists():
            data = json.loads(file.read_bytes())
        else:
            endpoint = 'https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date=' + key + '&response=json'
            data = fetch(endpoint, 10)
        if data.get('date') != key or not data.get('data'):
            return None
        all_dates = []
        for row in data['data']:
            y, m, d = map(int, row[0].split('/'))
            day = dt.date(y + 1911, m, d)
            if day.year != month.year or day.month != month.month:
                return None
            if day <= finish:
                all_dates.append(day)
        if not file.exists():
            file.write_text(json.dumps(data, ensure_ascii=False), encoding='utf8')
        return all_dates
    except (OSError, ValueError, KeyError, TypeError):
        return None

def collect(item, target, prior, timeout):
    day, source = item
    filename = day.strftime('%Y%m%d') + '-' + source + '.json'
    file = target / filename
    if file.exists():
        return source, 'cached'
    try:
        prev = prior / filename if prior else None
        if prev and prev.exists():
            data = json.loads(prev.read_bytes())
        else:
            data = fetch(market_urls(day)[source], timeout)
        if not isinstance(data, dict) or 'stat' not in data:
            return source, 'invalid'
        file.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
        return source, 'read'
    except (OSError, ValueError) as err:
        return source, str(getattr(err, 'code', type(err).__name__))

def backfill(start, end, target, prior, workers, timeout):
    from collections import Counter
    target.mkdir(parents=True, exist_ok=True)
    months = sorted({day.replace(day=1) for offset in range((end - start).days + 1)
                     if (day := start + dt.timedelta(days=offset)).weekday() < 5})
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for month in months:
            dates = monthly_dates(month, end, target)
            verified = dates is not None
            if not verified:
                dates = [month + dt.timedelta(days=i) for i in range(31)
                         if (month + dt.timedelta(days=i)).month == month.month
                         and (month + dt.timedelta(days=i)).weekday() < 5]
            requests = [(d,k) for d in dates if start <= d <= end for k in ('tw','ot','tc','oc')]
            stats = Counter(pool.map(lambda item: collect(item, target, prior, timeout), requests))
            print(month.strftime('%Y-%m'), '核對官方交易日' if verified else '日期待核對',
                  ' '.join(f'{k}/{s}={n}' for (k,s),n in sorted(stats.items())), flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('start', type=dt.date.fromisoformat)
    parser.add_argument('end', type=dt.date.fromisoformat)
    parser.add_argument('output', type=Path)
    parser.add_argument('--prior', type=Path)
    parser.add_argument('--workers', type=int, default=6)
    parser.add_argument('--timeout', type=int, default=8)
    a = parser.parse_args()
    if a.start > a.end or not 1 <= a.workers <= 8:
        parser.error('Check date range and choose between 1 and 8 workers.')
    backfill(a.start, a.end, a.output, a.prior, a.workers, a.timeout)
