#!/usr/bin/env python3
"""Render tests/journeys/STEPS.md from the step list below and the CC-45 register.

Usage: python3 tests/journeys/tools/steps.py <cc-45/sweep.md> tests/journeys/STEPS.md
(the register lives in the plan folder, outside the repo; this script is the tracked record of how
STEPS.md and expected-fail.json were made from it)
The expected-fail column and the defect index are computed from the register's "Step or stream"
column (plus MANUAL for rows that name no journey step), so they cannot disagree with it.
"""
import re, sys
from collections import defaultdict

sweep, out = sys.argv[1], sys.argv[2]
text = open(sweep).read()
rows = re.findall(r'^\| (F-\d{3}) \| ([^|]+?) \| ([^|]+?) \|', text, re.M)

# Rows registered from code inventories (inbox 019) name no journey step; this is where a customer meets them.
MANUAL = {
 'F-135':['J0.5b'],'F-136':['J2.4d','J2.5'],'F-137':['J0.5b'],'F-138':['J0.5a','J0.5b'],'F-139':['J0.5a'],
 'F-140':['J0.5a'],'F-141':['J0.5b'],'F-142':['J0.5a'],'F-143':['J0.5b'],'F-144':['J0.5b'],'F-145':['J0.5a','J0.5b'],
 'F-146':['J0.1','J0.5i'],'F-147':['J1.10'],'F-148':['J0.5h'],'F-149':['J0.5b','J0.5h'],'F-150':['J0.5b'],
 'F-151':['J0.5h'],'F-152':['J0.5b'],'F-153':['J0.5b','J0.9j'],'F-154':['J0.9j'],'F-155':['J0.5b'],'F-156':['J0.5b'],
 'F-157':['J2.3'],'F-163':['J4.6'],'F-158':['J0.9m'],'F-159':['J0.5a'],'F-160':['J0.5a'],'F-161':['J0.5i'],'F-162':['J0.5h'],
}

# D steps declared read-only by the session writing them (A1 question 016, the consent PR).
D_NO_WRITES = ['D.F-045', 'D.F-048', 'D.F-049', 'D.F-067', 'D.F-088']

# Rows the register files under a parent step (J0.5, J0.8, J0.9, J1.12, J2.4, J4), placed on the sub-step the
# CC-45 scorecard (sweep.md §3) names for them. A parent step's own list is the union of its sub-steps'.
SUBMAP = {
 'F-005':{'J0.2':['J0.2','J0.9k']},
 'F-004':{'J0.5':['J0.5i']}, 'F-012':{'J0.5':['J0.5a','J0.5c','J2.4h']}, 'F-020':{'J0.5':['J0.5a']},
 'F-021':{'J0.5':['J0.5h']}, 'F-022':{'J0.5':['J0.5i']}, 'F-023':{'J0.5':['J0.5b']}, 'F-057':{'J0.5':['J0.5a']},
 'F-013':{'J0.8':['J0.8f']}, 'F-014':{'J0.8':['J0.8e']}, 'F-015':{'J0.8':['J0.8c']}, 'F-054':{'J0.8':['J0.8h']},
 'F-055':{'J0.8':['J0.8i']},
 'F-006':{'J0.9':['J0.2','J0.9d','J0.9e','J0.9f','J0.9g','J0.9i','J0.9j','J0.9k']}, 'F-007':{'J0.9':['J0.9a']}, 'F-024':{'J0.9':['J0.9b']},
 'F-026':{'J0.9':['J0.9l']}, 'F-027':{'J0.9':['J0.9h']}, 'F-031':{'J0.9':['J0.9j']}, 'F-032':{'J0.9':['J0.9i']},
 'F-033':{'J0.9':['J0.9k']}, 'F-063':{'J0.9':['J0.9g']}, 'F-072':{'J0.9':['J0.9d','J0.9e']},
 'F-128':{'J1.12':['J1.12a']}, 'F-132':{'J1.12':['J1.12a']},
 'F-016':{'J2.4':['J2.4d','J2.4e']}, 'F-096':{'J2.4':['J2.4e']}, 'F-097':{'J2.4':['J2.4g']}, 'F-099':{'J2.4':['J2.4b']},
 'F-107':{'J2.4':['J2.4f']}, 'F-109':{'J2.4':['J2.4c']}, 'F-115':{'J2.4':['J2.4a']}, 'F-121':{'J2.4':['J2.4d']},
 'F-125':{'J2.4':['J2.4f']}, 'F-126':{'J2.4':['J2.4f']},
 'F-127':{'J4':['J4.2']}, 'F-130':{'J4':['J4.3']}, 'F-133':{'J4':['J4.7']}, 'F-134':{'J4':['J4.5']},
}
PARENTS = ['J0.5','J0.8','J0.9','J1.12','J2.4','J4']

# Ids a step's test cannot observe (a judgement: positioning, legal wording, a published address; or F-050, a
# server-side PostHog event a browser step cannot see). They stay in
# STEPS.md, marked "(judged)", and out of expected-fail.json, so fixing an observable id never forces their deletion.
JUDGED = {
 'D.F-050':['F-050'], 'J0.1':['F-061','F-062'], 'J0.9d':['F-072'], 'J0.9e':['F-072'], 'J0.9j':['F-153','F-154'], 'J0.9k':['F-033'],
}

def steps_of(fid, col):
    raw = steps_raw(fid, col)
    out = []
    for s_ in raw:
        out += SUBMAP.get(fid, {}).get(s_, [s_])
    return out

def steps_raw(fid, col):
    if fid in MANUAL: return MANUAL[fid]
    found = []
    for m in re.finditer(r'J(\d)(?:\.(\d+))?(?:\s*[–-]\s*J\1\.(\d+))?', col):
        j, a, b = m.group(1), m.group(2), m.group(3)
        if a is None: found.append(f'J{j}')
        elif b: found += [f'J{j}.{k}' for k in range(int(a), int(b)+1)]
        else: found.append(f'J{j}.{a}')
    return found or [f'D.{fid}']

index = {}; sev = {}
for fid, s, col in rows:
    index[fid] = list(dict.fromkeys(steps_of(fid, col))); sev[fid] = s.split()[0]
by_step = defaultdict(list)
for fid, ss in index.items():
    for s in ss: by_step[s].append(fid)

def subs_of(p):
    return [s_ for s_ in all_steps if s_ != p and (s_.startswith(p) and re.fullmatch(re.escape(p) + (r'\.\d+' if p == 'J4' else r'[a-z]'), s_))]

def sub_any(parent, f):
    return next((sub for sub in subs_of(parent) if f in JUDGED.get(sub, [])), parent)

def mark(step, f):
    return f + ' (judged)' if f in JUDGED.get(step, []) else f

def xf(step):
    ids = [mark(step, f) for f in by_step.get(step, [])]
    if step in PARENTS:
        own = ids
        union = sorted(set(own) | {f for sub in subs_of(step) for f in by_step.get(sub, [])})
        judged = {f for sub in subs_of(step) for f in JUDGED.get(sub, [])}
        union = [mark(sub_any(step, f), f) if f in judged else f for f in union]
        tail = ' (with its sub-steps)' if union != sorted(own) else ''
        return (', '.join(union) if union else '—') + tail
    return ', '.join(ids) if ids else '—'

# Each step: id, what the customer does, pass means, account, devices, writes
J = {
'J0': ('Visitor who never signs up', 'anonymous', [
 ('J0.1','Land on the home page; read it top to bottom','In five seconds it is clear what this is, who it is for and what it costs','desktop, phone, Firefox, WebKit','no'),
 ('J0.2','Use every header and footer entry once','Every entry opens a finished v2 page (200, v2 shell)','desktop, phone, Firefox, WebKit','no'),
 ('J0.3','Start a check from the home form on a lab site','A check starts and the live page opens','desktop, phone, Firefox, WebKit','yes'),
 ('J0.4','Watch the live page from start to finish without touching it','Progress is visible within 5 s, keeps moving, the graph draws, and the result opens','desktop, phone, Firefox','yes'),
 ('J0.5','Read the result: every card, every tab, the fix, the link map','Each part below reads true for the site checked','desktop, phone, Firefox','yes'),
 ('J0.5a','Overview: the door, every card, the grade or the honest withheld state','Every sentence is true of what was measured','desktop, phone','yes'),
 ('J0.5b','Crawler access tab','Each crawler row says what we sent, from where, and what it proves; three states, never two','desktop, phone','yes'),
 ('J0.5c','Without JavaScript tab','A words-without-JavaScript figure, or a stated reason it was not measured','desktop, phone','yes'),
 ('J0.5d','Structure tab','Orphans, depth and structure fixes match the crawl','desktop, phone','yes'),
 ('J0.5e','Content tab','Content checks shown or honestly not applicable','desktop, phone','yes'),
 ('J0.5f','Signals tab','Signals shown with their source','desktop, phone','yes'),
 ('J0.5g','Changes tab','A first check says nothing is compared yet; a second lists real changes','desktop, phone','yes'),
 ('J0.5h','Open a fix fully','The fix, its packet and its title are true and usable','desktop, phone','yes'),
 ('J0.5i','Link map: hover, click, zoom, list view, search','The graph draws, labels show, keys work, list and search agree','desktop, phone','yes'),
 ('J0.6','"Email me the result" on a second check; follow the email back','The mail arrives and its link opens the result','desktop','yes'),
 ('J0.7','Return to the result link later','It says how long it is kept and what to do next','desktop, phone','no'),
 ('J0.8','Give it bad input (a–i below)','Each ends in a clear message','desktop, phone','yes'),
 ('J0.8a','An empty box','A clear message, no check','desktop, phone','no'),
 ('J0.8b','`not a url`','A clear message, no check','desktop, phone','no'),
 ('J0.8c','A site that does not exist','A clear "could not reach" result, not an all-clear','desktop','yes'),
 ('J0.8d','`localhost`','A clear refusal, no check','desktop, phone','no'),
 ('J0.8e','A lab site that blocks crawlers','The result says what each crawler got back','desktop','yes'),
 ('J0.8f','A JavaScript-only lab site','The result says the content needs JavaScript','desktop','yes'),
 ('J0.8g','A slow lab site','The check finishes inside its stated time, with progress throughout','desktop','yes'),
 ('J0.8h','The same site twice in a row','The second start is explained (reused or refused)','desktop','yes'),
 ('J0.8i','Cancel a running check','The cancel is confirmed and the page says what happened','desktop','yes'),
 ('J0.9','Open each named page (a–m below)','Each is a finished v2 page','desktop, phone, Firefox','no'),
 ('J0.9a','`/pricing`','v2 pricing, numbers from the code','desktop, phone','no'),
 ('J0.9b','`/agencies`, `/agency-trial`','v2 agency offer','desktop, phone','no'),
 ('J0.9c','`/help`','v2 help','desktop','no'),
 ('J0.9d','`/guides`','v2 guides','desktop, phone','no'),
 ('J0.9e','A blog post','v2 post','desktop, phone','no'),
 ('J0.9f','The research page','v2 page','desktop','no'),
 ('J0.9g','`/status`','v2 status with a real state','desktop','no'),
 ('J0.9h','`/developers`','v2 developers page','desktop','no'),
 ('J0.9i','`/ai-readiness-checker`','v2 page','desktop','no'),
 ('J0.9j','`/bot`','v2 page describing exactly what we send, with the published address','desktop','no'),
 ('J0.9k','Every legal page (privacy, terms, AUP, subprocessors, refunds, DPA, cookies)','v2 pages; none missing','desktop','no'),
 ('J0.9l','An address that does not exist','v2 404','desktop, phone','no'),
 ('J0.9m','`/check/gptbot`, `/check/javascript`, `/check/robots-ai`','A real result for the visitor\'s site, or copy that says it starts an audit','desktop','no'),
]),
'J1': ('Free customer, beginning to end', 'a new Free account', [
 ('J1.1','J0 steps 1–5 on one site','As J0.1–J0.5','desktop, phone','yes'),
 ('J1.2','Keep the result with an email address','The keep form works without an interactive challenge','desktop, phone','yes'),
 ('J1.3','Open the sign-in email; judge it; follow it','A v2 email; one Continue; signed in','desktop','yes'),
 ('J1.4','Signed in: the site just checked is in the dashboard with its result','The kept check is the person\'s site','desktop, phone','no'),
 ('J1.5','From the dashboard open the site, the result, each tab, each fix; one fix fully','All open, tables fit, numbers formatted','desktop, phone','no'),
 ('J1.6','Go home signed in; start a check from the home form','The header knows the person; the check belongs to their account','desktop, phone','yes'),
 ('J1.7','Add a second site on Free','The limit is explained with a clear way to upgrade (v2 pricing)','desktop, phone','yes'),
 ('J1.8','Visit every dashboard menu item and setting','Each opens; locked features say why and how to unlock','desktop, phone','no'),
 ('J1.9','Theme: System, Light, Dark on the dashboard and on a result','Both follow the choice and keep it','desktop, phone','yes'),
 ('J1.10','Run a second check of the same site; read Changes','Changes lists what changed and agrees with the rail','desktop','yes'),
 ('J1.11','Share or publish the report if Free allows; open the public link signed out','The offer is clear; a link opens signed out','desktop','yes'),
 ('J1.12','Sign out; sign in again from `/login` and once from `/signup` with the same address','Sign-out exists and confirms; both sign-ins work without an edge challenge','desktop','yes'),
 ('J1.12a','Sign out','A sign-out in v2, with a "signed out" note','desktop','yes'),
 ('J1.12b','Sign in from `/login`, then from `/signup`','Both reach the dashboard','desktop','yes'),
 ('J1.13','Unsubscribe through an email\'s link; Settings agrees','The link works and Settings shows it off','desktop','yes'),
 ('J1.14','Delete the account; confirm; restore inside the window; delete again; sign-in no longer finds it','Each step does what it says','desktop','yes'),
]),
'J2': ('Pro customer, beginning to end', 'a new account on the Pro trial; seeded `+pro`, `+protrial` on staging', [
 ('J2.1','A new person: J1 steps 1–4','As J1.1–J1.4','desktop','yes'),
 ('J2.2','Start the 14-day Pro trial from inside the product','What you get, for how long and what happens at the end are clear','desktop','yes'),
 ('J2.3','Add sites up to the limit (5), each with its first check; try a sixth; a check reads up to the plan\'s pages','Five run; the sixth is refused with a clear message; a Pro check reads up to 2,000 pages','desktop','yes'),
 ('J2.4','Use every feature the pricing and sign-up pages promise for Pro (a–i below)','Each works as promised','desktop','yes'),
 ('J2.4a','Weekly checks','Each site shows weekly and the next date','desktop','no'),
 ('J2.4b','Every fix with its packet (open three, copy one)','Packets open and copy','desktop','no'),
 ('J2.4c','Send one fix to a developer by email','A control exists and the mail is sent','desktop','yes'),
 ('J2.4d','Alerts and each integration, as far as the screen allows','Rules save; integrations open a page','desktop','yes'),
 ('J2.4e','One competitor','The competitor is audited and compared','desktop','yes'),
 ('J2.4f','Every export (PDF, CSV, JSON, link-map CSV); open each file','Each file is made and opens','desktop','yes'),
 ('J2.4g','Staging audits','The staging URL is audited','desktop','yes'),
 ('J2.4h','Every page measured for Without JavaScript','Pages carry a measured figure','desktop','yes'),
 ('J2.4i','Daily watch: a crawler newly blocked','One full check and one alert the same day','desktop','yes'),
 ('J2.5','Second check on one site; read Changes and any alert it should cause','Changes is right; a due alert is sent','desktop','yes'),
 ('J2.6','Reports: create, schedule, send; judge the report and its email','Each works or is clearly not on this plan','desktop','yes'),
 ('J2.7','Open the plan and billing screens with billing off','They say exactly what applies with billing off','desktop','no'),
 ('J2.8','J1 steps 8, 9, 12 and 13 again as Pro','As J1.8, J1.9, J1.12, J1.13','desktop','yes'),
 ('J2.9','Seeded `+protrial`: start its trial; seeded `+pro`: what plan and what it can do','Each matches the seed','desktop','yes'),
]),
'J3': ('Agency customer, beginning to end', 'a new Agency trial; seeded `+agency`, `+agency-dev`, `+agencytrial`, `+demo` on staging', [
 ('J3.1','Start from the agencies page as a new person; start the agency trial','The offer is clear; the trial starts','desktop','yes'),
 ('J3.2','Set up the agency: name and brand','Both save and show','desktop','yes'),
 ('J3.3','Add five client sites (`client-*.lab.crawlmouse.com`), each with its first check; where is 25 shown','All five run; the 25-site limit is shown in the add flow','desktop','yes'),
 ('J3.4','Invite a team member; judge the invite email; accept it in a separate context','The member sees and does what the role allows','desktop','yes'),
 ('J3.5','Change the member\'s role; remove the member','Access ends at once','desktop','yes'),
 ('J3.6','Client reports under the agency\'s brand: create, public link signed out, send, schedule','Crawlmouse\'s name is gone wherever white-label is promised','desktop','yes'),
 ('J3.7','J2 steps 4–6 on a client site','As J2.4–J2.6','desktop','yes'),
 ('J3.8','Plan, seats and billing screens: extra seats, extra sites','They say what applies','desktop','no'),
 ('J3.9','Seeded `+agency`, `+agency-dev`, `+agencytrial`, `+demo`','Each dashboard matches the seed','desktop','no'),
]),
'J4': ('Somebody else\'s data', 'two accounts A and B, A\'s removed member, a user with no v2 account, signed out', [
 ('J4','Every address and request of A tried as B, as A\'s removed member, signed in with no v2 account (a user with no active seat) and signed out; ids changed in addresses and bodies','Nothing private shown or changed; a refused id and a missing id get the same answer, so neither reveals the id exists','desktop','yes (it sends writes that must be refused)'),
 ('J4.1','A\'s site pages (incl. staging)','B 404 / signed out to sign-in','desktop','yes (it creates test accounts)'),
 ('J4.2','A\'s kept results: every tab, map, fixes, checks','The one 404 page a missing id gets, offering sign-in; nothing shows the id exists','desktop','yes (it creates test accounts)'),
 ('J4.3','A\'s changes, alerts, reports, settings, plan, delete, seats, agency, billing','B sees only its own account','desktop','yes (it creates test accounts)'),
 ('J4.4','Export files and fix packets; email-developer','404 / 401','desktop','yes (it creates test accounts)'),
 ('J4.5','Share links and report pages','Open only what was shared; no pivot','desktop','yes (it creates test accounts)'),
 ('J4.6','Every API call in A\'s network log, replayed as B, signed out, and signed in with no v2 account (a user with no active seat), with ids changed; each also with a random id that does not exist','Refused; no write crosses accounts; an existing private id and a missing id answer the same status and body','desktop','yes (it replays writes)'),
 ('J4.7','v1 API routes','410 or refused','desktop','yes (it creates test accounts)'),
]),
}
SMOKE = [
 ('SMOKE.1','Home','`/` answers 200 with the v2 page','no'),
 ('SMOKE.2','A check start to finish on a lab site','Finishes; result opens','yes'),
 ('SMOKE.3','Sign-in','A staging account reaches its dashboard','yes'),
 ('SMOKE.4','The dashboard','Loads with the account\'s sites','no'),
 ('SMOKE.5','A result with all tabs','Every tab answers 200','no'),
 ('SMOKE.6','`robots.txt`','Matches the pinned document','no'),
 ('SMOKE.7','The sitemap','Answers and lists the pinned URLs','no'),
 ('SMOKE.8','`/api/health`','`{ ok: true }` with the expected commit','no'),
]

L = []
w = L.append
w('# Journey steps — the ids builders cite')
w('')
w('This is the step list for `tests/journeys/`. Each step is named by its CC-45 step number (CC-45 brief §5),')
w('so a builder can write "closes J0.5b" in a PR. Where one CC-45 step covers several screens, QA added lettered')
w('sub-steps (J0.5a–i, J0.8a–i, J0.9a–m, J1.12a–b, J2.4a–h) and numbered J4\'s parts (J4.1–J4.7); a defect the')
w('register files under a parent step is placed on the sub-step CC-45\'s scorecard names, and a parent\'s list is')
w('the union of its sub-steps. A step passes when a customer would get what the screen promised, in the time it')
w('promised, on the devices listed.')
w('')
w('**Generated, not hand-written.** The "Expected to fail today" column and the defect index at the end are computed')
w('from the CC-45 register (`cc-45/sweep.md` §1, its "Step or stream" column) by `tools/steps.py`, then formatted by Prettier. Rows the')
w('register names by stream only get a defect-named step, `D.F-nnn`, checked by a dedicated test. Re-generate when the')
w('register changes; do not edit the columns by hand.')
w('')
w('**Expected-fail.** `expected-fail.json` holds, for each step, the ids its test can observe; it is generated with')
w('this file and it is the only list a test reads (`lib/step.ts`). Ids marked "(judged)" here are checked by hand at the')
w('gate, not by the test. A step\'s test fails red when it passes while ids are still listed, and when it fails for a')
w('reason that names none of its listed ids. A PR that fixes a defect deletes that id from `expected-fail.json`. This')
w('file\'s column stays as CC-45 found it.')
w('')
w('**Writes.** A step whose cell is anything but exactly "no" is treated as writing: it changes data (a check, an')
w('account, a mail), needs a check it starts itself, or sends writes that must be refused. `lib/target.ts` runs such')
w('a step only on staging\'s host, and only after the deployment\'s own headers show staging\'s database; never on')
w('production, a Vercel preview or localhost. Steps marked "no" may run anywhere.')
w('')
w('**Sites checked.** Only `*.lab.crawlmouse.com` and `nahltech.com`: `lib/sites.ts` refuses any other host for a step')
w('that starts a check.')
w('')
all_steps = [s_ for _,(_,_,st) in J.items() for s_,*_ in st]
for jid,(title,acct,steps) in J.items():
    w(f'## {jid} — {title}')
    w('')
    w(f'Account: {acct}.')
    w('')
    w('| Step | The customer | Passes when | Devices | Writes | Expected to fail today |')
    w('|---|---|---|---|---|---|')
    for sid,what,passes,dev,wr in steps:
        w(f'| {sid} | {what} | {passes} | {dev} | {wr} | {xf(sid)} |')
    w('')
w('## SMOKE — run on every gate')
w('')
w('| Step | What | Passes when | Writes |')
w('|---|---|---|---|')
for sid,what,passes,wr in SMOKE: w(f'| {sid} | {what} | {passes} | {wr} |')
w('')
dsteps = sorted(s for s in by_step if s.startswith('D.'))
w('## D — defects with no journey step')
w('')
w(f'{len(dsteps)} register rows name a stream, not a journey step. Each, except a judged id, gets a dedicated test named `D.F-nnn`, written by')
w('the session that fixes it (RULES §3 step 2), under `tests/journeys/d/`.')
w('')
w(', '.join(dsteps))
w('')
judged_d = sorted(k for k in JUDGED if k.startswith('D.'))
w('Judged, so checked by hand at the gate and absent from `expected-fail.json`: ' + ', '.join(f'{d} ({", ".join(JUDGED[d])}, judged)' for d in judged_d) + '.')
w('')
missing = [d for d in D_NO_WRITES if d not in dsteps]
assert not missing, f'D_NO_WRITES names no D step: {missing}'
w('### D steps that write nothing')
w('')
w('A D step counts as writing, and runs only on staging, unless this table says exactly `no`. The session that writes')
w('the test asks QA to list it here.')
w('')
w('| Step | Writes |')
w('| --- | --- |')
for d in D_NO_WRITES:
    w(f'| {d} | no |')
w('')
w('## Defect index')
w('')
w('Every register row and the steps that prove it closed.')
w('')
w('| Defect | Sev | Steps |')
w('|---|---|---|')
for fid in sorted(index): w(f'| {fid} | {sev[fid]} | {", ".join(index[fid])} |')
w('')
known = {s for _,(_,_,st) in J.items() for s,*_ in st} | {s for s,*_ in SMOKE}
orphan = sorted(s for s in by_step if not s.startswith('D.') and s not in known)
w(f'Rows in the index: {len(index)}. Steps named by the register that are not in the tables above: {", ".join(orphan) if orphan else "none"}.')
open(out,'w').write('\n'.join(L)+'\n')
import json, os
expected = {}
for sid in all_steps + [x for x,*_ in SMOKE] + [d for d in by_step if d.startswith('D.')]:
    ids = sorted(set(by_step.get(sid, [])) | ({f for sub in subs_of(sid) for f in by_step.get(sub, [])} if sid in PARENTS else set()))
    judged = set(JUDGED.get(sid, [])) | ({f for sub in subs_of(sid) for f in JUDGED.get(sub, [])} if sid in PARENTS else set())
    ids = [f for f in ids if f not in judged]
    if ids: expected[sid] = ids
json.dump(expected, open(os.path.join(os.path.dirname(out), 'expected-fail.json'), 'w'), indent=2, sort_keys=True)
open(os.path.join(os.path.dirname(out), 'expected-fail.json'), 'a').write('\n')
print('rows',len(index),'dsteps',len(dsteps),'orphan',orphan)
