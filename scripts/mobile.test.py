"""Exercise the built frontend at two phone sizes and a desktop viewport."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json
import os
import shutil
import subprocess

root=Path(__file__).resolve().parents[1]
screens=os.environ.get('MOBILE_QA_SCREENSHOTS')
if screens:
    Path(screens).mkdir(parents=True,exist_ok=True)
bundle=subprocess.run(['node','--input-type=module','-e',"""
import app from './dist/server/index.js';
const files={};
for(const path of ['/','/app.js','/style.css','/install.js','/manifest.webmanifest']){
    const res=await app.fetch(new Request('https://research.test'+path),{});
    files[path]=[res.headers.get('Content-Type'),await res.text()];
}
console.log(JSON.stringify(files));
"""],cwd=root,check=True,capture_output=True,text=True)
assets=json.loads(bundle.stdout)
defaults={'horizon':5,'limit':5,'market':'all','score':60,'amount':20,'fee':.1425,'tax':.3,'slip':.1,'tech':45,'fund':25,'chip':30,'rules':[]}
stock={'id':'L2330','name':'台積電','close':1065,'change':2.35,'score':83.2,'tech':83,'fund':81,'chip':85,'momentum':12.4,'above':8.2,'volume':1.6,'yoy':21.8,'eps':3.2,'pe':18.2,'ocf':2400,'chipRatio':5.83,'buyDays':4,'sellDays':1,'leader':'外資','bullish':True,'foreign':1500,'trust':-130,'dealer':250,'active':200,'hedge':50,'forecast':{'prob':62.4,'upside':2.4,'basis':'價量＋籌碼基準','n':53,'days':12}}
trade={'date':'2026-11-20','id':'L2330','name':'台積電','entry':'2026-11-23','exit':'2026-11-26','gross':3.5,'net':2.7,'status':'done','forecast':stock['forecast'],'horizon':5,'bullish':True}
buy_signal={'kind':'buy','days':4,'ratio':5.83,'leader':'外資','prob':62.4,'upside':2.4}
sell_signal={'kind':'pressure','days':4,'ratio':-4.2,'leader':'投信'}
stock['signal']=buy_signal

with sync_playwright() as tools:
    chromium=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
    browser=tools.chromium.launch(executable_path=chromium)
    for width,height in [(390,844),(402,874),(1440,960)]:
        phone=width<768
        settings=dict(defaults)
        context=browser.new_context(viewport={'width':width,'height':height}, screen={'width':width,'height':height}, device_scale_factor=3 if phone else 1, is_mobile=phone, has_touch=phone, accept_downloads=True, locale='zh-TW', timezone_id='Asia/Taipei', service_workers='block', user_agent=tools.devices['iPhone 13']['user_agent'] if phone else None)
        page=context.new_page()
        runtime_errors=[]
        page.on('pageerror',lambda e:runtime_errors.append(str(e)))
        def handle(route):
            path=route.request.url.removeprefix('https://research.test').split('?')[0]
            if path in assets:
                kind,body=assets[path]
                return route.fulfill(body=body,content_type=kind)
            if path=='/api/settings':
                if route.request.method=='POST':
                    settings.update(route.request.post_data_json)
                return route.fulfill(json=settings)
            if path=='/api/status':
                return route.fulfill(json={'today':'2026-11-26','date':'2026-11-25','note':'目前為最近已取得交易日','days':72,'start':'2026-08-11','listedFlowDays':12,'otcFlowDays':72})
            if path=='/api/picks':
                other={**stock,'id':'O6590','name':'普鴻','forecast':{'n':3},'bullish':False,'pe':35,'ocf':None,
                       'signal':{'kind':'accumulation','days':4,'ratio':5.83,'leader':'外資'}}
                return route.fulfill(json={'date':'2026-11-25','fundamentalsDate':'2026-11-26','frame':True,'frozen':False,'rows':[stock,other],'count':1952,'cash':12,'valuation':1546,'config':settings})
            if path=='/api/stock/history':
                return route.fulfill(json={'id':'L2330','bars':[{'date':'2026-11-25','close':1065}],'series':{},'failed':[]})
            if path in ('/api/stock','/api/analysis'):
                report={'id':'L2330','name':'台積電','indicators':{'adx14':27.23,'supertrendDirection':1,'mfi14':61.42,'cmf20':3.18},'history':[{'date':'2026-11-24','close':1010},{'date':'2026-11-25','close':1065}],'info':{'yoy':56.5,'eps':78.7,'month':'2026-10','revenue':586890319,'pe':21.88,'pb':7.97,'valuationDate':'2026-11-25','period':'2026Q3'},'cash':{'ocf':2402116.7,'fcf':1112145.9,'date':'2026-09-30'}}
                if path=='/api/analysis':
                    report.update({'marketAsOf':'2026-11-25','ownership':stock,
                        'peers':{'count':1,'industry':'半導體業','median':{'yoy':{'value':18,'n':1}},'target':report['info'],'rows':[{'id':'L2303','name':'聯電','yoy':18}]},
                        'disclosures':{'available':True,'from':'2026-11-25','to':'2026-11-25','items':[{'date':'2026-11-25','title':'公布簽訂測試合約','label':'訂單／合約','details':'以官方揭露內容為準。'}]}})
                return route.fulfill(json=report)
            if path=='/api/backtest':
                body=route.request.post_data_json
                if body['start'] and body['end'] and body['start']>body['end']:
                    return route.fulfill(status=400,json={'error':'起始日須早於結束日。'})
                return route.fulfill(json={'mode':body['mode'],'daily':[{'date':'2026-11-20','net':2.7},{'date':'2026-11-21','net':-1.2}], 'coverage':{'frameCount':0,'start':'2026-09-08','end':'2026-11-25'},'rows':[trade]*25})
            if path=='/api/track':
                return route.fulfill(json={'summary':{'total':1,'done':1,'win':100,'net':2.7,'brier':.2,'mae':.3,'forecastCount':1},'joined':[{**trade,'signal':sell_signal}],'logs':[{'date':'2026-11-20'}],'next':None})
            if path=='/api/observations':
                record={'date':'2026-11-20','name':'台積電','id':'L2330','signal':sell_signal,'state':'observing','end':'2027-02-18',
                    'latest':{'date':'2026-11-25','value':2.7},'points':[{'date':'2026-11-23','value':1.5},{'date':'2026-11-25','value':2.7}],
                    'checkpoints':{'30':None,'60':None,'90':None},'high':2.7,'low':1.5}
                return route.fulfill(json={'rows':[record],'groups':[],'asOf':'2026-11-25','next':None})
            if path=='/api/refresh':
                return route.fulfill(json={'state':'已更新交易日與推薦。'})
            return route.fulfill(status=404)
        page.route('https://research.test/**',handle)
        def actions():
            return page.locator('nav a, #pwa-install, main button, main input, main select, dialog[open] button, dialog[open] input, dialog[open] select')
        def sizing(label):
            metrics=actions().evaluate_all('els=>els.filter(e=>e.getClientRects().length).map(e=>[e.textContent.trim()||e.name,Math.round(e.getBoundingClientRect().width),Math.round(e.getBoundingClientRect().height)])')
            small=[m for m in metrics if min(m[1:])<44]
            overflow=page.evaluate('document.documentElement.scrollWidth>innerWidth')
            wide=page.locator('.table-wrap').evaluate_all('els=>els.filter(e=>e.getClientRects().length&&e.scrollWidth>e.clientWidth).length')
            print(width,label,'small',small[:8],'page-overflow',overflow,'wide-tables',wide)
            if phone:
                assert not small,(label,small)
                assert not overflow,label
                assert not wide,label
        def activate(loc):
            loc.tap() if phone else loc.click()
        def nav(id):
            activate(page.locator(f'nav [data-tab="{id}"]'))
            page.locator('#'+id).wait_for(state='visible')
        page.goto('https://research.test/')
        page.get_by_role('button',name='台積電',exact=False).first.wait_for()
        export_link=page.get_by_role('link',name='匯出 HTML')
        assert export_link.get_attribute('href')=='/export.html'
        assert export_link.bounding_box()['height']>=44
        activate(page.get_by_role('button',name='安裝研究台'))
        help_dialog=page.get_by_role('dialog',name='安裝研究台')
        assert ('Safari' if phone else 'Chrome 或 Edge') in help_dialog.inner_text()
        activate(help_dialog.get_by_role('button',name='關閉'))
        sizing('picks')
        reasons=page.locator('#screen tbody tr').first.locator('.score-breakdown li')
        assert reasons.nth(0).inner_text().endswith('（83.0 分）')
        assert '20 日動能 +12.4%，加分' in reasons.nth(0).inner_text()
        assert 'MA20 均線乖離 +8.2%' in reasons.nth(0).inner_text()
        assert reasons.nth(1).inner_text().endswith('（81.0 分）')
        assert '月營收年增率 +21.8%，加分' in reasons.nth(1).inner_text()
        other_fund=page.locator('#screen tbody tr').nth(1).locator('.score-breakdown li').nth(1).inner_text()
        assert '本益比 35.0 倍，減分' in other_fund and '營業現金流' not in other_fund
        assert reasons.nth(2).inner_text().endswith('（85.0 分）')
        assert '投信賣超 130 張' in reasons.nth(2).inner_text()
        assert '占同期成交量 +5.8%，加分' in reasons.nth(2).inner_text()
        signals=page.locator('#screen .market-signal')
        assert '建議購入' in signals.nth(0).inner_text() and '4／5 日淨買超 · 外資' in signals.nth(0).inner_text()
        assert '主力建倉訊號' in signals.nth(1).inner_text()
        if screens: page.screenshot(path=Path(screens)/f'{width}-picks.png',scale='css')
        trigger=page.locator('#screen [data-stock]').first
        activate(trigger)
        page.get_by_role('heading',name='台積電 2330 · 上市').wait_for()
        sizing('stock')
        assert page.locator('dialog .market-signal').get_by_text('建議購入').is_visible()
        activate(page.locator('dialog summary').filter(has_text='均線與趨勢'))
        assert page.locator('dialog dl').get_by_text('27.23',exact=True).is_visible()
        if screens: page.screenshot(path=Path(screens)/f'{width}-stock.png',scale='css')
        with page.expect_download() as history:
            activate(page.get_by_role('button',name='下載近三年資料'))
        assert history.value.suggested_filename=='2330-historical-data.json'
        assert json.loads(Path(history.value.path()).read_text())['bars'][0]['close']==1065
        activate(page.get_by_role('button',name='關閉',exact=True))
        assert trigger.evaluate('e=>e===document.activeElement')
        activate(page.get_by_role('button',name='查詢個股'))
        field=page.locator('#lookup').get_by_label('股票代碼')
        assert field.evaluate('e=>e!==document.activeElement')
        field.fill('2330')
        activate(page.get_by_role('button',name='查詢',exact=True))
        page.get_by_role('heading',name='台積電 2330 · 上市').wait_for()
        page.keyboard.press('Escape')
        assert page.locator('#search').evaluate('e=>e===document.activeElement')
        nav('rules')
        sizing('rules')
        activate(page.get_by_role('button',name='新增條件'))
        facet=page.locator('[name=ruleGroup]')
        indicator=page.locator('[name=ruleField]')
        assert facet.input_value()=='technical'
        assert indicator.input_value()=='k9'
        page.get_by_label('門檻').fill('70')
        query=page.locator('[name=ruleQuery]')
        query.fill('不存在的指標')
        page.get_by_text('找不到符合的指標。').wait_for()
        assert indicator.input_value()=='k9'
        assert page.get_by_label('門檻').input_value()=='70'
        query.fill('唐奇安')
        page.get_by_text('找到 4 項指標').wait_for()
        assert indicator.locator('option[value=donchianHighGap20]').count()==1
        query.fill('ＭＡＣＤ')
        page.get_by_text('找到 3 項指標').wait_for()
        query.press('Enter')
        assert indicator.evaluate('el=>el===document.activeElement')
        indicator.select_option('macdHistogram')
        assert query.input_value()==''
        query.fill('千張')
        indicator.select_option('holders15Pct')
        assert facet.input_value()=='ownership'
        assert page.get_by_label('門檻').input_value()==''
        facet.select_option('technical')
        facet.select_option('ownership')
        assert indicator.input_value()=='holders1000'
        assert page.get_by_label('門檻').input_value()==''
        facet.select_option('fundamentals')
        assert indicator.input_value()=='revenue'
        indicator.select_option('yoy')
        page.get_by_label('門檻').fill('10')
        page.get_by_label('每日候選上限').select_option('4')
        activate(page.get_by_role('button',name='儲存策略'))
        page.get_by_text('已儲存。',exact=True).wait_for()
        assert settings['limit']==4 and settings['rules']==[{'field':'yoy','op':'gte','value':10}]
        assert facet.input_value()=='fundamentals'
        assert indicator.input_value()=='yoy'
        if screens: page.screenshot(path=Path(screens)/f'{width}-rules.png',scale='css')
        nav('backtest')
        page.get_by_label('訊號起日').fill('2026-11-25')
        page.get_by_label('訊號迄日',exact=True).fill('2026-11-20')
        activate(page.get_by_role('button',name='執行回測'))
        page.get_by_text('起始日須早於結束日。',exact=True).wait_for()
        page.get_by_label('訊號起日').fill('2026-11-01')
        activate(page.get_by_role('button',name='執行回測'))
        page.get_by_text('成本後勝率',exact=True).wait_for()
        sizing('backtest')
        activate(page.get_by_role('button',name='下一頁',exact=True))
        assert page.get_by_text('13–24 / 25',exact=True).is_visible()
        with page.expect_download() as download:
            activate(page.get_by_role('button',name='匯出 CSV'))
        assert download.value.suggested_filename.endswith('.csv')
        assert len(Path(download.value.path()).read_text(encoding='utf-8-sig').splitlines())==26
        nav('track')
        page.locator('#track').get_by_text('已結算',exact=True).first.wait_for()
        assert page.locator('#track-trades .market-signal').get_by_text('籌碼賣壓').is_visible()
        activate(page.locator('#track-trades [data-stock]').first)
        page.locator('dialog .market-signal').get_by_text('籌碼賣壓').wait_for()
        activate(page.get_by_role('button',name='關閉',exact=True))
        sizing('track')
        page.get_by_role('heading',name='90 天觀察紀錄').wait_for()
        assert page.locator('#track-90 .market-signal').get_by_text('籌碼賣壓').is_visible()
        activate(page.locator('#track-90 [data-observation]'))
        page.get_by_role('heading',name='台積電 · 90 天觀察').wait_for()
        assert page.locator('dialog .market-signal').get_by_text('籌碼賣壓').is_visible()
        assert page.locator('#detail svg').is_visible()
        activate(page.get_by_role('button',name='關閉',exact=True))
        sizing('observations')
        nav('analysis')
        page.locator('#analysis').get_by_label('股票代碼').fill('2330')
        activate(page.get_by_role('button',name='分析個股'))
        page.get_by_role('heading',name='台積電 2330 · 上市').wait_for()
        for section in ('基本面','技術面','籌碼面','同業比較','訂單與營運展望'):
            assert page.get_by_role('heading',name=section,exact=True).is_visible()
        assert page.get_by_role('link',name='聯電 2303').is_visible()
        activate(page.locator('#analysis summary').filter(has_text='公布簽訂測試合約'))
        assert page.get_by_text('以官方揭露內容為準。').is_visible()
        sizing('analysis')
        nav('sources')
        page.get_by_role('heading',name='資料來源').wait_for()
        sizing('sources')
        assert not runtime_errors,runtime_errors
        context.close()
    browser.close()
