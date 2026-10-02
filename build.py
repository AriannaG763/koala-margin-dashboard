import sys
from datetime import datetime
from zoneinfo import ZoneInfo

scratch = sys.argv[1]

with open(scratch + '/template_with_placeholders.html', 'r', encoding='utf-8') as f:
    tpl = f.read()

with open(scratch + '/daily.json', 'r', encoding='utf-8') as f:
    daily = f.read()

with open(scratch + '/status.json', 'r', encoding='utf-8') as f:
    status = f.read()

MONTHS_IT = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
             'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
now = datetime.now(ZoneInfo('Europe/Rome'))
gen_date = '%d %s %d, %02d:%02d %s' % (
    now.day, MONTHS_IT[now.month - 1], now.year, now.hour, now.minute, now.tzname())

assert tpl.count('__DAILY_JSON__') == 1, tpl.count('__DAILY_JSON__')
assert tpl.count('__GEN_DATE__') == 1, tpl.count('__GEN_DATE__')
assert tpl.count('__STATUS_JSON__') == 1, tpl.count('__STATUS_JSON__')

out = tpl.replace('__DAILY_JSON__', daily)
out = out.replace('__STATUS_JSON__', status)
out = out.replace('__GEN_DATE__', gen_date)

with open(scratch + '/koala-margin-dashboard.html', 'w', encoding='utf-8') as f:
    f.write(out)

print('wrote', len(out), 'bytes')
