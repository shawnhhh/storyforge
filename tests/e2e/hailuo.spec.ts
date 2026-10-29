import {test,expect} from '@playwright/test'
for(const broken of [false,true])test(`H3 official protocol fixture ${broken?'rejects truncated result':'publishes verified CAS result'} without overwriting content`,async({page})=>{
 await page.goto('/#video');await page.getByRole('button',{name:'新建视频项目',exact:true}).click()
 await page.getByLabel('视频名称',{exact:true}).fill('H3-'+crypto.randomUUID());await page.getByLabel('剧本',{exact:true}).fill('保留剧本');await page.getByRole('button',{name:'保存视频项目',exact:true}).click();await expect(page.locator('[data-video-message]')).toContainText('保存')
 await page.getByLabel('小说ID',{exact:true}).fill('fixture-novel');await page.getByLabel('章节ID',{exact:true}).fill('fixture-chapter');await page.getByLabel('分镜ID',{exact:true}).fill('fixture-shot');await page.getByLabel('角色ID（逗号分隔）',{exact:true}).fill('fixture-character');await page.getByLabel('素材ID（逗号分隔）',{exact:true}).fill('fixture-material');
 // A slow settings save must not remount the panel and erase a newly typed prompt/model.
 let finishSave!:()=>void;const saved=new Promise<void>(resolve=>{finishSave=resolve})
 await page.route('**/api/studio/projects/*',async route=>{if(route.request().method()==='PUT')await saved;await route.continue()})
 const saving=page.waitForRequest(r=>r.method()==='PUT'&&r.url().includes('/api/studio/projects/'))
 await page.getByRole('button',{name:'保存单镜头配置',exact:true}).click();await saving
 await page.getByLabel('单镜头生成模型',{exact:true}).selectOption('MiniMax-H3');await page.getByLabel('单镜头提示词',{exact:true}).fill(broken?'[broken] blue scene':'blue scene');finishSave()
 await expect(page.getByRole('status').filter({hasText:'单镜头配置已保存'})).toBeVisible()
 await expect(page.getByLabel('单镜头生成模型',{exact:true})).toHaveValue('MiniMax-H3');await expect(page.getByLabel('单镜头提示词',{exact:true})).toHaveValue(broken?'[broken] blue scene':'blue scene')
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'生成 H3 视频',exact:true}).click()
 await expect(page.locator('.video-editor')).toContainText(broken?'failed':'completed',{timeout:20000});const library=page.getByRole('region',{name:'大型媒体库'});await expect(library.locator('video')).toHaveCount(broken?0:1)
 if(!broken){await expect.poll(()=>library.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThan(0);const src=await library.locator('video').getAttribute('src');expect((await page.request.get(src!)).status()).toBe(200)}
 const before=await(await page.request.get('/api/studio/projects?kind=video')).json();const id=before[0].id
 await page.reload();await page.getByRole('button',{name:before[0].title,exact:true}).click();await expect(page.getByLabel('剧本',{exact:true})).toHaveValue('保留剧本');const after=await(await page.request.get(`/api/studio/projects/${id}`)).json();expect(after).toEqual(before[0]);expect(JSON.parse(after.settings.sourceLinks)).toEqual({novelId:'fixture-novel',chapterId:'fixture-chapter',shotId:'fixture-shot',characterIds:['fixture-character'],materialIds:['fixture-material']})
 const costs=await(await page.request.get('/api/studio/costs')).json();expect(costs.monthly.reservedMicros).toBeGreaterThanOrEqual(650000)
})
