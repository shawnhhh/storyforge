import {test,expect} from '@playwright/test'
test('virtual paid Mock requires cost confirmation, cancellation creates no task, completion reserves once',async({page})=>{
 await page.goto('/#music');await page.getByLabel('歌曲名称',{exact:true}).fill('费用确认-'+crypto.randomUUID());await page.getByRole('button',{name:'创建歌曲',exact:true}).click()
 await page.getByLabel('生成模型',{exact:true}).selectOption('mock-metered')
 page.once('dialog',async dialog=>{expect(dialog.message()).toContain('不会真实扣费');await dialog.dismiss()})
 await page.getByRole('button',{name:'生成 Mock 音乐',exact:true}).click()
 await expect(page.getByRole('list',{name:'生成任务'}).getByRole('listitem')).toHaveCount(0)
 const before=await(await page.request.get('/api/studio/costs')).json()
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'生成 Mock 音乐',exact:true}).click()
 await expect(page.getByRole('list',{name:'生成任务'})).toContainText('completed')
 const after=await(await page.request.get('/api/studio/costs')).json();expect(after.monthly.reservedMicros-before.monthly.reservedMicros).toBe(2000);expect(after.monthly.spentMicros-before.monthly.spentMicros).toBe(2000)
 const providers=await(await page.request.get('/api/studio/providers')).json();expect(providers[0].keyConfigured).toBe(false);expect(JSON.stringify(providers)).not.toContain('apiKey')
})
