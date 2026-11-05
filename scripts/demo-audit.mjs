import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {randomUUID,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
if(!process.argv.includes('--apply-demo')) throw Error('Explicit --apply-demo required; creates training data locally');
const path='data/demo-audit-state.json';
const state=existsSync(path)?JSON.parse(readFileSync(path)): {steps:{},roles:{},checks:[]};
const save=()=>writeFileSync(path,JSON.stringify(state,null,2),{mode:0o600});
function client(){let cookie='',csrf=''; return {async req(method,path,body,key=randomUUID()) {const r=await fetch('http://127.0.0.1:3000/api/v1'+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf,'Idempotency-Key':key},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const data=await r.json();if(data.csrf)csrf=data.csrf;return{status:r.status,data}},async ok(...args){const r=await this.req(...args);assert.equal(r.status,200,args[1]+': '+JSON.stringify(r.data));return r.data},session(){return{cookies:[{name:'bytmarket_session',value:cookie.slice(cookie.indexOf('=')+1),domain:'127.0.0.1',path:'/',httpOnly:true,secure:false,sameSite:'Lax',expires:-1}],origins:[]}}};}
async function step(name,fn){if(!(name in state.steps)){state.steps[name]=await fn();save();}return state.steps[name];}
const access=readFileSync('data/Доступ владельца.txt','utf8');const root=client();await root.ok('POST','/auth/login',{email:access.match(/^Логин:\s*(.+)$/m)[1].trim(),password:access.match(/^Пароль:\s*(.+)$/m)[1].trim()});
const meta=await root.ok('GET','/meta');const e=meta.entities.find(x=>x.kind==='ooo').id,ip=meta.entities.find(x=>x.kind==='ip').id,w=meta.warehouses[0].id;
state.scope={e,ip,w};state.settings??=meta.settings;save();
const names={owner:'Владелец',seller:'Продавец',manager:'Менеджер',rep:'Торговый представитель',accountant:'Бухгалтер',warehouse:'Кладовщик',dispatcher:'Диспетчер',courier:'Курьер',other_courier:'Второй курьер'};const clients={};mkdirSync('data/audit-sessions',{recursive:true});
for(const [role,name] of Object.entries(names)){if(!state.roles[role]){state.roles[role]={email:`test.${role}@bytmarket.local`,password:randomBytes(18).toString('base64url')};save();}const a=state.roles[role];a.user=await step('user-'+role,()=>root.ok('POST','/users',{name:'[Тест] '+name,...a,roles:[role==='other_courier'?'courier':role],entity_ids:[e,ip],warehouse_ids:[w]}));const c=client();await c.ok('POST','/auth/login',{email:a.email,password:a.password});clients[role]=c;writeFileSync(`data/audit-sessions/${role}.json`,JSON.stringify(c.session()),{mode:0o600});}
writeFileSync('data/Тестовые роли.txt','Учебные учётные записи. Не использовать для реальных операций.\nhttp://127.0.0.1:3000\n\n'+Object.entries(names).map(([r,n])=>`${n}\nЛогин: ${state.roles[r].email}\nПароль: ${state.roles[r].password}\n`).join('\n'),{mode:0o600});
const groups=[['Порошок для стирки','Стирка','3 кг'],['Гель для стирки','Стирка','1,5 л'],['Кондиционер для белья','Стирка','1 л'],['Жидкое мыло','Гигиена','500 мл'],['Средство для посуды','Кухня','500 мл'],['Средство для пола','Уборка','1 л'],['Средство для стёкол','Уборка','500 мл'],['Чистящий крем','Уборка','500 мл'],['Губки для посуды','Хозтовары','5 шт'],['Мешки для мусора','Хозтовары','30 л']];
const scents=['Лимон','Свежесть','Лаванда','Без аромата','Яблоко','Хлопок','Морской','Цветочный','Алоэ','Нейтральный'];
const products=await step('products',async()=>{const rows=Array.from({length:100},(_,i)=>{const [name,category,volume]=groups[Math.floor(i/10)];const raw='290'+String(i+1).padStart(9,'0');const check=(10-[...raw].reduce((s,n,j)=>s+Number(n)*(j%2?3:1),0)%10)%10;return{sku:`TEST-100-${String(i+1).padStart(3,'0')}`,name:`[Тест] ${name} ${volume} / ${scents[i%10]}`,barcode:raw+check,brand:'Учебная марка',category,pack_size:12,retail_cents:18000+i*300,wholesale_cents:15000+i*250,min_stock:50,attributes:{inner_pack_size:3,volume,scent:scents[i%10],demo:true}}});const preview=await root.ok('POST','/products/import/preview',{rows});assert.equal(preview.valid,true,JSON.stringify(preview.errors));return(await root.ok('POST','/products/import',{rows,preview_hash:preview.preview_hash},'demo-100-import-v1')).products;});
const supplier=await step('supplier',()=>clients.accountant.ok('POST','/clients',{name:'[Тест] Учебный поставщик',kind:'supplier'}));
for(const [key,entity] of [['ooo',e],['ip',ip]]){const purchase=await step('purchase-'+key,()=>clients.accountant.ok('POST','/purchases',{entity_id:entity,warehouse_id:w,supplier_id:supplier.id,notes:'[Тест] Учебная закупка, не реальные обязательства',lines:products.map((p,i)=>({product_id:p.id,qty:i>94?36:120,cost_cents:9000+i*100}))}));await step('receipt-'+key,()=>clients.warehouse.ok('POST',`/purchases/${purchase.id}/receive`,{}));}
state.checks=state.checks.filter(x=>x.name!=='100 SKU imported and received for both entities');state.checks.push({name:'100 SKU imported and received for both entities',at:new Date().toISOString()});save();
console.log(JSON.stringify({products:products.length,roles:Object.keys(clients).length,stage:'seed complete'}));
const check=(name,condition)=>{assert.ok(condition,name);state.checks=state.checks.filter(x=>x.name!==name);state.checks.push({name,at:new Date().toISOString()});save();};
await root.ok('PATCH','/settings',{wholesale_min_qty:1});
try {
const customer=await step('customer',()=>root.ok('POST','/clients',{name:'[Тест] Магазин Уют',assigned_to:state.roles.rep.user.id,credit_limit_cents:10000000,term_days:7,address:'Астрахань, учебный адрес'}));
const order=await step('wholesale-order',()=>clients.rep.ok('POST','/orders',{entity_id:e,warehouse_id:w,client_id:customer.id,channel:'wholesale',fulfillment:'delivery',address:'Астрахань, учебный адрес',notes:'[Тест] Полный цикл аудита',lines:[{product_id:products[0].id,quantity:3,unit:'box'}]}));
check('3 boxes = 36 pieces',order.lines[0].qty===36);
await step('wholesale-confirm',()=>clients.rep.ok('POST',`/orders/${order.id}/confirm`,{}));
const delivery=await step('delivery',()=>clients.dispatcher.ok('POST','/deliveries',{order_id:order.id,courier_id:state.roles.courier.user.id,collect_on_delivery:true,places:3}));
await step('packing',()=>clients.warehouse.ok('POST',`/orders/${order.id}/packing`,{status:'ready',lines:{[order.lines[0].id]:36}}));
await step('ship',()=>clients.warehouse.ok('POST',`/orders/${order.id}/ship`,{}));
await step('in-transit',()=>clients.courier.ok('PATCH',`/deliveries/${delivery.id}`,{status:'in_transit'}));
await step('delivered',()=>clients.courier.ok('PATCH',`/deliveries/${delivery.id}`,{status:'delivered'}));
await step('delivered-unpaid',async()=>{const o=await root.ok('GET',`/orders/${order.id}`);assert.equal(o.paid_cents,0);return true});
const amount=order.total_cents;
const pay=await step('partial-payment',()=>clients.courier.ok('POST','/payments',{entity_id:e,order_id:order.id,amount_cents:amount/2,method:'cash'},'demo-courier-partial-v1'));
await step('partial-check',async()=>{const o=await root.ok('GET',`/orders/${order.id}`);assert.equal(o.paid_cents,amount/2);return true});
const duplicate=await clients.courier.ok('POST','/payments',{entity_id:e,order_id:order.id,amount_cents:amount/2,method:'cash'},'demo-courier-partial-v1');check('Payment retry does not duplicate',duplicate.id===pay.id);
await step('rep-payment',()=>clients.rep.ok('POST','/payments',{entity_id:e,order_id:order.id,amount_cents:amount/2,method:'cash'}));
for(const role of ['courier','rep']){const h=await step('handover-'+role,()=>clients[role].ok('POST','/cash/handovers',{entity_id:e,amount_cents:amount/2,note:'[Тест] Сдача наличных'}));await step('handover-confirm-'+role,()=>clients.accountant.ok('POST',`/cash/handovers/${h.id}/confirm`,{}));}
check('Second courier sees no чужие deliveries',(await clients.other_courier.ok('GET','/deliveries')).length===0);
check('Second courier cannot open чужой order',(await clients.other_courier.req('GET',`/orders/${order.id}`)).status===403);
check('Seller cannot change prices',(await clients.seller.req('PATCH',`/products/${products[0].id}`,{retail_cents:1})).status===403);
await step('return',()=>clients.warehouse.ok('POST',`/orders/${order.id}/return`,{lines:[{line_id:order.lines[0].id,qty:2}],reason:'[Тест] Частичный возврат'}));
await step('refund',()=>clients.accountant.ok('POST','/refunds',{order_id:order.id,amount_cents:products[0].wholesale_cents*2,method:'cash',reason:'[Тест] Возврат денег'}));
const inventory=await root.ok('GET','/stock');const inv=inventory.find(x=>x.product_id===products[0].id&&x.entity_id===e);check('Returns quarantined; usable stock 84 plus quarantine 2',inv.on_hand===84&&inv.quarantine===2&&inv.available===84);
const retail=await step('retail',()=>clients.seller.ok('POST','/orders',{entity_id:ip,warehouse_id:w,channel:'retail',fulfillment:'pickup',notes:'[Тест] Розничная продажа',lines:[{product_id:products[1].id,quantity:2,unit:'piece'}]}));
await step('retail-confirm',()=>clients.seller.ok('POST',`/orders/${retail.id}/confirm`,{}));
await step('retail-cash',()=>clients.seller.ok('POST','/payments',{entity_id:ip,order_id:retail.id,amount_cents:retail.total_cents/2,method:'cash'}));
await step('retail-bank',()=>clients.accountant.ok('POST','/payments',{entity_id:ip,order_id:retail.id,amount_cents:retail.total_cents/2,method:'bank',reference:'[Тест] Проверка смешанной оплаты'}));
await step('retail-ship',()=>clients.seller.ok('POST',`/orders/${retail.id}/ship`,{}));
const visit=await step('visit',()=>clients.rep.ok('POST','/visits',{client_id:customer.id,scheduled_at:new Date().toISOString(),note:'[Тест] Визит'}));await step('visit-complete',()=>clients.rep.ok('PATCH',`/visits/${visit.id}`,{status:'completed',result:'[Тест] Заказ оформлен'}));
const managerClient=await step('manager-client',()=>clients.manager.ok('POST','/clients',{name:'[Тест] Клиент менеджера'}));
await step('manager-task',()=>clients.manager.ok('POST','/tasks',{entity_id:e,client_id:managerClient.id,title:'[Тест] Повторный звонок',due_date:new Date().toISOString().slice(0,10)}));
check('Owner receives low stock alerts',(await root.ok('GET','/alerts')).length>=5);
const report=await root.ok('GET',`/reports/overview?entity_id=${e}`);state.report=report;save();
check('Wholesale net sales reconciled',report.sales_cents===products[0].wholesale_cents*34);
console.log(JSON.stringify({checks:state.checks.length,stage:'full journey complete',sales_cents:report.sales_cents,gross_profit_cents:report.gross_profit_cents}));
} finally {await root.ok('PATCH','/settings',{wholesale_min_qty:state.settings.wholesale_min_qty});}
