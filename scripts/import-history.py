"""Import normalized history archives into this private Site using stdin credentials."""
import argparse
import json
from pathlib import Path
import sys
import urllib.error
import urllib.request
from daily import SITE, NoRedirect

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archives', type=Path)
    args = parser.parse_args()
    token = sys.stdin.readline().strip()
    if not token:
        raise SystemExit('Site credential must be passed on stdin.')
    opener = urllib.request.build_opener(NoRedirect)
    rejected = 0
    for path in sorted(args.archives.glob('????-??.gz')):
        request = urllib.request.Request(SITE+'/api/history/import?month='+path.stem,
            data=path.read_bytes(), headers={'Content-Type':'application/gzip','OAI-Sites-Authorization':'Bearer '+token})
        try:
            with opener.open(request, timeout=70) as response:
                print(json.load(response),flush=True)
        except urllib.error.HTTPError as err:
            print({'month':path.stem,'http':err.code},flush=True)
            rejected += 1
    if rejected:
        raise SystemExit(f'{rejected} monthly archives could not be imported.')
