"""Read official Taiwan exchange data and send it to this private Site."""
import concurrent.futures
import datetime as dt
import json
import sys
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

SITE = 'https://taiwan-equity-lab.valiantbun4.chatgpt.site'
TW = 'https://openapi.twse.com.tw/v1'
OT = 'https://www.tpex.org.tw/openapi/v1'
TDCC = 'https://opendata.tdcc.com.tw/getOD.ashx?id=1-5'
DISCLOSURES = {'L': TW + '/opendata/t187ap04_L', 'O': OT + '/mopsfin_t187ap04_O'}
FIELDS = ('ci', 'basi', 'fh', 'bd', 'ins', 'mim')
FUNDAMENTALS = {
    'tm': TW + '/opendata/t187ap03_L',
    'om': OT + '/mopsfin_t187ap03_O',
    'tr': TW + '/opendata/t187ap05_L',
    'or': OT + '/mopsfin_t187ap05_O',
    'tv': TW + '/exchangeReport/BWIBBU_ALL',
    'ov': OT + '/tpex_mainboard_peratio_analysis',
    **{'t_' + f: TW + '/opendata/t187ap06_L_' + f for f in FIELDS},
    **{'o_' + f: OT + '/mopsfin_t187ap06_O_' + f for f in FIELDS},
}

def market_urls(day):
    c = day.strftime('%Y%m%d')
    d = day.strftime('%Y/%m/%d')
    return {
        'tw': f'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date={c}&type=ALLBUT0999&response=json',
        'ot': f'https://www.tpex.org.tw/www/zh-tw/afterTrading/otc?date={d}&id=&type=EW&response=json',
        'tc': f'https://www.twse.com.tw/rwd/zh/fund/T86?date={c}&selectType=ALLBUT0999&response=json',
        'oc': f'https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade?date={d}&type=Daily&sect=EW&response=json',
    }

def fetch(pair):
    name, url = pair
    try:
        request = urllib.request.Request(url, headers={'Accept': 'application/json'})
        with urllib.request.urlopen(request, timeout=16) as response:
            return name, json.load(response)
    except (OSError, ValueError) as err:
        print(f'{name}: {type(err).__name__} {getattr(err, "code", "")}', file=sys.stderr)
        return name, None

def fetch_many(urls):
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        return {k: v for k, v in pool.map(fetch, urls.items()) if v is not None}

def fetch_tdcc():
    try:
        request = urllib.request.Request(TDCC, headers={'Accept': 'text/csv'})
        with urllib.request.urlopen(request, timeout=16) as response:
            csv = response.read(6_000_001)
            return csv.decode('utf-8-sig') if len(csv) <= 6_000_000 else None
    except (OSError, UnicodeError) as err:
        print(f'TDCC: {type(err).__name__}', file=sys.stderr)
        return None

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def site_call(path, token, payload=None):
    headers = {'OAI-Sites-Authorization': 'Bearer ' + token, 'Accept': 'application/json'}
    body = None
    if payload is not None:
        headers['Content-Type'] = 'application/json'
        body = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode()
    request = urllib.request.Request(SITE + path, headers=headers, data=body)
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(request, timeout=105) as response:
            return json.load(response)
    except urllib.error.HTTPError as err:
        try:
            result = json.load(err)
        except ValueError:
            result = {'error': 'Site HTTP ' + str(err.code)}
        if err.code != 422:
            raise RuntimeError(result.get('error') or result) from None
        return result

def rows(group):
    return group.get('data') or next((t['data'] for t in group.get('tables', []) if t.get('data')), [])

def confirmed_closed(day, today, calendar):
    month = day.replace(day=1)
    key = month.strftime('%Y%m01')
    if key not in calendar:
        endpoint = 'https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date=' + key + '&response=json'
        _, report = fetch(('calendar', endpoint))
        if not report or report.get('date') != key or report.get('stat') != 'OK':
            calendar[key] = set()
        else:
            dates = set()
            for row in report.get('data', []):
                try:
                    y, m, d = map(int, row[0].split('/'))
                    date = dt.date(y + 1911, m, d)
                    if date.replace(day=1) == month:
                        dates.add(date)
                except (ValueError, TypeError, IndexError):
                    continue
            calendar[key] = dates
    dates = calendar[key]
    return bool(dates) and day not in dates and (month < today.replace(day=1) or max(dates) > day)

def update_disclosures(token):
    feeds = fetch_many(DISCLOSURES)
    return site_call('/api/disclosures/import', token, feeds) if feeds else {}

def update(token):
    state = site_call('/api/status', token)
    try:
        print(json.dumps({'disclosures': update_disclosures(token)}, ensure_ascii=False))
    except (OSError, RuntimeError, ValueError) as err:
        print(f'Disclosures: {type(err).__name__}', file=sys.stderr)
    today = dt.datetime.now(ZoneInfo('Asia/Taipei')).date()
    last = dt.date.fromisoformat(state['date'])
    if state.get('latestSaved') == today.isoformat():
        site_call("/api/refresh", token, {})
        print(json.dumps(state, ensure_ascii=False))
        return
    first = min(last + dt.timedelta(days=1), today)
    if (today - first).days > 44:
        raise ValueError('已超出自動補資料範圍')
    calendar = {}
    for offset in range(min(7, (today - first).days + 1)):
        day = first + dt.timedelta(days=offset)
        if day.weekday() >= 5:
            continue
        market = fetch_many(market_urls(day))
        if {'tw', 'ot'} - market.keys():
            print(json.dumps({'date': day.isoformat(), 'state': '行情來源未完整'}, ensure_ascii=False))
            return
        if not rows(market['tw']) and not rows(market['ot']) and day < today:
            if confirmed_closed(day, today, calendar):
                continue
            print(json.dumps({'date': day.isoformat(), 'state': '待核對交易日與行情'}, ensure_ascii=False))
            return
        fundamentals = fetch_many(FUNDAMENTALS) if day == today else {}
        if day == today:
            csv = fetch_tdcc()
            if csv:
                fundamentals['tdcc'] = csv
        result = site_call('/api/ingest', token, {'date': day.isoformat(), 'market': market, 'fundamentals': fundamentals})
        print(json.dumps(result, ensure_ascii=False))
        if not result.get('coverage') or result.get('state'):
            return
    print(json.dumps(site_call('/api/status', token), ensure_ascii=False))

if __name__ == '__main__':
    credential = sys.stdin.readline().strip()
    if not credential:
        raise SystemExit('Site service credential must be provided on stdin.')
    update(credential)
