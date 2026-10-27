import { test, expect } from '@playwright/test'
test('large media uploads, plays and unified v2 restores copies through the browser',async({page})=>{
 await page.goto('/#music')
 const title='大媒体-'+crypto.randomUUID()
 await page.getByLabel('歌曲名称',{exact:true}).fill(title)
 await page.getByRole('button',{name:'创建歌曲',exact:true}).click()
 const panel=page.getByRole('region',{name:'大型媒体库'})
 // Valid PCM WAV larger than the old inline media limit.
 const data=Buffer.alloc(800044),rate=16000;data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(rate,24);data.writeUInt32LE(rate*2,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(data.length-44,40)
 await panel.getByLabel('上传大型媒体').setInputFiles({name:'large.wav',mimeType:'audio/wav',buffer:data})
 await expect(panel.getByText('媒体完整性校验通过并已保存',{exact:true})).toBeVisible()
 const audio=panel.getByLabel('large.wav',{exact:true});await expect(audio).toBeVisible()
 await expect.poll(()=>audio.evaluate(e=>(e as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(1)
 const download=page.waitForEvent('download');await panel.getByRole('button',{name:'下载统一备份 v2',exact:true}).click()
 const path=await(await download).path();expect(path).toBeTruthy()
 await panel.getByLabel('预览统一备份 v2').setInputFiles({name:'backup.sfm',mimeType:'application/octet-stream',buffer:await import('node:fs/promises').then(fs=>fs.readFile(path!))})
 await expect(panel.getByText(/备份预览：小说/)).toBeVisible()
 await panel.getByRole('button',{name:'确认恢复为新副本',exact:true}).click()
 await expect(panel.getByText('已恢复为新副本，请刷新项目列表',{exact:true})).toBeVisible()
 await page.reload();await expect(page.getByRole('button',{name:/恢复副本/}).first()).toBeVisible()
 // Remove only this fixture's references so later legacy-backup tests own their media assumptions.
 const health=await page.request.get('/api/health'),headers={'X-StoryForge-Generation':health.headers()['x-storyforge-generation']}
 const projects=await(await page.request.get('/api/studio/projects?kind=music')).json()
 for(const p of projects.filter((p:{title:string})=>p.title.includes(title)))for(const a of await(await page.request.get(`/api/studio/projects/${p.id}/media`)).json())expect((await page.request.delete(`/api/studio/media/${a.id}`,{headers,data:{}})).status()).toBe(204)
})
