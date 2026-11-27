const installButton=document.querySelector('#pwa-install');
const offlineStatus=document.querySelector('#pwa-offline');
const standalone=matchMedia('(display-mode: standalone)');
let installPrompt;
let installed=false;

function showConnection(){
  offlineStatus.hidden=navigator.onLine;
}
function showInstallButton(){
  installButton.hidden=installed||standalone.matches||navigator.standalone===true;
}
function showInstallHelp(){
  const apple=/iPad|iPhone|iPod/.test(navigator.userAgent)||
    (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const instructions=apple?'用 Safari 開啟研究台，點「分享」和「加入主畫面」。如果顯示「以網頁 App 開啟」，請啟用後點「加入」。':
    /Android/.test(navigator.userAgent)?'用 Chrome 開啟研究台，在選單中點「加到主畫面」，再選擇安裝。':
      '在 Chrome 或 Edge 的網址列尋找安裝圖示，或在瀏覽器選單中選擇安裝這個網站。';
  document.querySelector('#pwa-instructions').textContent=instructions;
  document.querySelector('#pwa-help').showModal();
}

window.addEventListener('online',showConnection);
window.addEventListener('offline',showConnection);
showConnection();

if('serviceWorker' in navigator&&window.top===window){
  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();
    installPrompt=event;
  });
  window.addEventListener('appinstalled',()=>{
    installPrompt=undefined;
    installed=true;
    showInstallButton();
  });
  standalone.addEventListener('change',showInstallButton);
  installButton.addEventListener('click',async()=>{
    if(!installPrompt){showInstallHelp();return;}
    const prompt=installPrompt;
    installPrompt=undefined;
    try{
      await prompt.prompt();
    }catch{
      showInstallHelp();
    }
  });
  showInstallButton();
  navigator.serviceWorker.register('./sw.js').catch(error=>console.warn('PWA service worker registration:',error.message));
}
