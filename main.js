import {initializeApp} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';
import {getAuth,onAuthStateChanged,signInAnonymously,setPersistence,browserLocalPersistence} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';

// STAGING ONLY PUBLIC web configuration; NEVER put service-account / Razorpay secrets here.
const firebaseConfig=Object.freeze({
  apiKey:'AIzaSyBKUP37m_j1gMzXcVMmBbQRMorRuSa6jCU',
  authDomain:'moin-quran-box-staging.firebaseapp.com',
  databaseURL:'https://moin-quran-box-staging-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId:'moin-quran-box-staging',
  storageBucket:'moin-quran-box-staging.firebasestorage.app',
  messagingSenderId:'552645389000',
  appId:'1:552645389000:web:fe1fa2fa23a8ed387013fd'
});
const BACKEND='https://mqb-v39-staging-test.onrender.com';
const PROJECT='moin-quran-box-staging';
const $=id=>document.getElementById(id);
const pill=(id,text,kind)=>{const e=$(id);e.textContent=text;e.className='pill '+kind;};
const say=(msg)=>{const el=$('log');el.textContent=`[${new Date().toLocaleTimeString()}] ${msg}\n`+el.textContent.slice(0,3500);};
const amount=paise=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(paise/100);
let auth,currentUser=null,backendReady=false,seedReady=false,order=null,paying=false;
function updateButtons(){
  $('create-order').disabled=!currentUser||!seedReady||paying;
  $('pay').disabled=!currentUser||!order||!backendReady||paying||order.paymentStatus==='verified';
  $('inspect').disabled=!currentUser||!order||paying;
}
function checkStatus(data){
  if(data.environment!=='staging'||data.firebaseProjectId!==PROJECT||data.livePaymentsEnabled!==false||
    !['test','test-disabled'].includes(data.mode)||data.paymentModel!=='customer-auto-confirm-v39')throw Error('Unsafe or unexpected backend identity: refusing test checkout');
  const enabled=data.mode==='test'&&data.checkoutReady===true&&data.testPaymentsEnabled===true&&data.autoConfirm===true;
  if(data.mode==='test'&&!enabled)throw Error('Inconsistent TEST readiness flags');
  return enabled;
}
async function status(){
  backendReady=false;seedReady=false;updateButtons();
  try{
    const response=await fetch(BACKEND+'/api/razorpay/status',{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('Backend returned '+response.status);
    const v=await response.json();backendReady=checkStatus(v);seedReady=v.testOrderSeedingEnabled===true;
    $('backend-project').textContent=v.firebaseProjectId;
    $('seed-state').textContent=seedReady?'Enabled':'Disabled';
    $('gateway-state').textContent=backendReady?'TEST ready':'TEST disabled';
    $('live-state').textContent='Always disabled';
    pill('backend-pill',backendReady?'TEST READY':seedReady?'PREPARING':'DISABLED',backendReady?'ok':seedReady?'warn':'neutral');
    say('Verified staging identity; seed '+(seedReady?'ready':'disabled')+'; payment '+(backendReady?'TEST ready':'disabled'));
  }catch(e){
    pill('backend-pill','Unreachable','bad');
    say('Backend status could not be verified: '+e.message+'. Check Render allowed origin and startup logs.');
  }finally{updateButtons();}
}
async function api(path,method='GET',body){
  if(!currentUser)throw Error('Staging sign-in required');
  const token=await currentUser.getIdToken();
  const response=await fetch(BACKEND+path,{method,cache:'no-store',signal:AbortSignal.timeout(30000),
    headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  let value;try{value=await response.json();}catch{throw Error('Backend returned an unreadable response ('+response.status+')');}
  if(!response.ok)throw Error(value.error||'Backend error '+response.status);
  return value;
}
function showOrder(){
  $('order-id').textContent=order?.orderId||'None yet';
  $('order-total').textContent=order?.totalPaise!==undefined?amount(order.totalPaise):'—';
  $('order-status').textContent=order?.status||'—';
  $('payment-status').textContent=order?.paymentStatus||'—';
  updateButtons();
}
$('copy-uid').onclick=async()=>{try{await navigator.clipboard.writeText(currentUser.uid);say('Copied staging tester UID.');}catch{ $('uid').select();say('Select the UID above and press Ctrl+C.');}};
$('copy-log').onclick=async()=>{try{await navigator.clipboard.writeText($('log').textContent);}catch{say('Copy the log manually.');}};
$('refresh-config').onclick=status;
$('create-order').onclick=async()=>{
  if(paying||!currentUser||!seedReady)return;
  $('create-order').disabled=true;
  try{
    const sku=document.querySelector('input[name="product"]:checked')?.value;
    const qty=Number($('qty').value);
    const created=await api('/api/staging/test-order','POST',{sku,qty});
    if(created.environment!=='staging'||created.currency!=='INR'||!Number.isSafeInteger(created.totalPaise)||created.totalPaise<100)throw Error('Untrusted staging order');
    order={...created};showOrder();say('Dummy staging order created '+order.orderId+' ('+amount(order.totalPaise)+'). NO payment initiated.');
  }catch(e){say('Could not create test order: '+e.message);}
  finally{updateButtons();}
};
$('inspect').onclick=async()=>{
  if(!order||paying)return;
  try{const result=await api('/api/staging/test-order/'+encodeURIComponent(order.orderKey));
    if(result.environment!=='staging'||result.orderId!==order.orderId)throw Error('Order identity mismatch');
    order={...order,...result};showOrder();say('Firebase status: '+result.status+' / '+result.paymentStatus);
  }catch(e){say('Could not inspect order: '+e.message);}
};
function ensureRazorpay(){return new Promise((resolve,reject)=>{
 if(typeof window.Razorpay==='function'){resolve();return;}
 const script=document.createElement('script');script.src='https://checkout.razorpay.com/v1/checkout.js';script.async=true;
 script.onload=()=>typeof window.Razorpay==='function'?resolve():reject(Error('Razorpay checkout script unavailable'));
 script.onerror=()=>reject(Error('Razorpay checkout could not load'));document.head.appendChild(script);
});}
$('pay').onclick=async()=>{
 if(!backendReady||!order||paying||order.paymentStatus==='verified')return;
 paying=true;updateButtons();
 try{
   const res=await api('/api/razorpay/create','POST',{orderKey:order.orderKey});
   if(!/^rzp_test_[A-Za-z0-9]{8,100}$/.test(res.keyId||'') ||
      !/^order_[A-Za-z0-9]{6,80}$/.test(res.razorpayOrderId||'')||
      res.amountPaise!==order.totalPaise||res.currency!=='INR'||res.additionalDeliveryPaise!==0)
       throw Error('Unexpected payment details; checkout blocked');
   await ensureRazorpay();
   await new Promise((resolve,reject)=>{
      const rzp=new window.Razorpay({key:res.keyId,amount:res.amountPaise,currency:'INR',
       name:'MOIN QURAN BOX — TEST',description:'STAGING ONLY • SIMULATED PAYMENT',order_id:res.razorpayOrderId,
       theme:{color:'#2054c5'},handler:async function(p){
         try{
          const verified=await api('/api/razorpay/verify','POST',{orderKey:order.orderKey,
           razorpay_order_id:p.razorpay_order_id,razorpay_payment_id:p.razorpay_payment_id,
           razorpay_signature:p.razorpay_signature});
          if(verified.confirmed!==true)throw Error('Backend did not confirm payment');
          order.status=verified.orderStatus;order.paymentStatus='verified';showOrder();
          say('TEST payment verified by backend; order automatically '+verified.orderStatus+'.');
          resolve();
         }catch(e){say('Payment may have succeeded but confirmation needs review. Do NOT pay again without checking status: '+e.message);reject(e);}
       },modal:{ondismiss:()=>{say('Checkout closed. This does NOT prove payment failed. Refresh status before retry.');resolve();}}});
      rzp.on('payment.failed',()=>say('Test attempt failed. Refresh status, then retry the same order if still pending.'));
      rzp.open();
   });
 }catch(e){say('Test payment flow halted: '+e.message);}
 finally{paying=false;updateButtons();}
};
try{
 if(firebaseConfig.projectId!==PROJECT||!firebaseConfig.databaseURL.includes('moin-quran-box-staging'))throw Error('Invalid staging Firebase config');
 const app=initializeApp(firebaseConfig);auth=getAuth(app);
 await setPersistence(auth,browserLocalPersistence);
 onAuthStateChanged(auth,async user=>{
   if(user){currentUser=user;$('uid').value=user.uid;$('copy-uid').disabled=false;pill('auth-pill','Signed in','ok');say('Signed into staging Firebase anonymously. Tester UID available above.');updateButtons();}
   else try{await signInAnonymously(auth);}catch(e){pill('auth-pill','Sign-in failed','bad');say('Staging anonymous sign-in failed: '+e.message);}
 });
 status();
}catch(e){pill('auth-pill','Failed','bad');say('STAGING sign-in initialization error: '+e.message);}
