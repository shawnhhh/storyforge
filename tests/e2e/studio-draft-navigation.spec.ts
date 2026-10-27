import {test,expect} from '@playwright/test'
import {expectChapterReady} from './editor-helpers.js'
test('unsaved novel cannot be unmounted by music or video hash navigation',async({page})=>{
 await page.goto('/')
 await page.getByRole('button',{name:'创建小说',exact:true}).first().click()
 await page.getByRole('dialog').getByLabel('小说名称').fill('小说导航保护')
 await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click()
 await page.getByRole('button',{name:'创建第一章',exact:true}).click()
 const body=await expectChapterReady(page,'第 1 章')
 await page.route('**/api/chapters/*',async route=>route.request().method()==='PUT'?route.abort('failed'):route.continue())
 await body.fill('未保存的小说正文')
 for(const hash of ['#music','#video']){
  await page.evaluate(value=>{location.hash=value},hash)
  await expect(page.getByRole('heading',{level:1})).toHaveText('小说导航保护')
  await expect(body).toHaveText('未保存的小说正文')
  await expect(page).toHaveURL(/#story$/)
 }
})
