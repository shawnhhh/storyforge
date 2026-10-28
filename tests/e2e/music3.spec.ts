import {test,expect} from '@playwright/test'
test('official Music3 protocol fixture generates a persistent large WAV without modifying lyrics',async({page})=>{
 await page.goto('/#music');const title='Music3-fixture-'+crypto.randomUUID()
 await page.getByLabel('歌曲名称',{exact:true}).fill(title);await page.getByRole('button',{name:'创建歌曲',exact:true}).click()
 await page.getByLabel('歌词',{exact:true}).fill('[Verse]\n测试歌词保持原样');await page.getByRole('button',{name:'保存歌词与配置',exact:true}).click();await expect(page.getByRole('button',{name:'保存歌词与配置',exact:true})).toBeDisabled()
 await page.getByLabel('生成模型',{exact:true}).selectOption('minimax_ttm');await page.getByRole('button',{name:'生成 Music3 音乐',exact:true}).click()
 await expect(page.getByRole('list',{name:'生成任务'})).toContainText('completed')
 const audio=page.getByRole('region',{name:'大型媒体库'}).getByLabel('music3.wav',{exact:true});await expect(audio).toBeVisible();await expect.poll(()=>audio.evaluate(e=>(e as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(1)
 await expect(page.getByLabel('歌词',{exact:true})).toHaveValue('[Verse]\n测试歌词保持原样')
 await page.reload();await page.getByRole('button',{name:title,exact:true}).click();await expect(audio).toBeVisible()
 const response=await page.request.get((await audio.getAttribute('src'))!);expect(response.status()).toBe(200);expect((await response.body()).length).toBe(800044)
 const providers=await(await page.request.get('/api/studio/providers')).json();expect(providers.find((p:{id:string})=>p.id==='music3-selfhost').capabilities).toEqual({remoteQuery:false,remoteCancel:false,remoteIdempotency:false,webhook:false,localCancellation:true})
})
