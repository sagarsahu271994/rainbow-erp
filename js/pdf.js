App.Pdf={header(title){return '<div class="doch"><img src="'+App.logoPath+'" alt=""><div><h2>'+App.esc(App.db.settings.name)+'</h2><p>'+App.esc(App.db.settings.address)+'</p><b>'+App.esc(title)+'</b></div></div>'},

admissionHtml(a){return this.header("Admission Form")+'<div class="docgrid"><div><b>Date:</b> '+App.esc(a.date)+'</div><div><b>Admission ID:</b> '+App.esc(a.admissionId)+'</div><div><b>Student:</b> '+App.esc(a.studentName)+'</div><div><b>Class:</b> '+App.esc(a.className)+'</div><div><b>Father:</b> '+App.esc(a.fatherName)+'</div><div><b>Mother:</b> '+App.esc(a.motherName)+'</div><div><b>Mobile:</b> '+App.esc(a.mobile)+'</div><div><b>School:</b> '+App.esc(a.schoolName||"-")+'</div><div><b>Batch:</b> '+App.esc(a.batch||"-")+'</div><div><b>Address:</b> '+App.esc(a.address||"-")+'</div></div><div class="signature-row"><div>Parent Signature</div><div>Authorized Signature</div></div>'},

/**
 * FEATURE 8 — Professional Fee Receipt.
 * Rainbow ERP branding (via header()), Receipt Number, Student Details
 * (name, class, admission number when available), Payment Details (mode,
 * monthly/paid/total, transaction id, remarks when present), School Details
 * (via header()), and a QR placeholder reserved for a future real QR code
 * (e.g. payment verification link) without changing the PDF layout later.
 * Admission Number and Remarks are optional — receipts created from the
 * older manual Fees form won't have them and those lines are simply omitted.
 * @param {object} f fee receipt item
 * @returns {string}
 */
receiptHtml(f){
  const admissionLine=f.admissionId?'<div><b>Admission No.:</b> '+App.esc(f.admissionId)+'</div>':'';
  const remarksLine=f.remarks?'<div><b>Remarks:</b> '+App.esc(f.remarks)+'</div>':'';
  return this.header("Fees Receipt")
    +'<div class="docgrid">'
    +'<div><b>Receipt No.:</b> '+App.esc(f.receiptNo)+'</div>'
    +'<div><b>Date:</b> '+App.esc(f.date)+'</div>'
    +'<div><b>Student:</b> '+App.esc(f.studentName)+'</div>'
    +'<div><b>Class:</b> '+App.esc(f.className||"-")+'</div>'
    +admissionLine
    +'<div><b>Month:</b> '+App.esc(f.month||App.monthKey(f.date))+'</div>'
    +'<div><b>Payment Mode:</b> '+App.esc(f.paymentMode||"Cash")+'</div>'
    +'<div><b>Monthly Fees:</b> '+App.rs(f.monthly)+'</div>'
    +'<div><b>Paid Fees:</b> '+App.rs(f.fees)+'</div>'
    +'<div><b>Total Paid:</b> '+App.rs(f.total)+'</div>'
    +'<div><b>Transaction ID:</b> '+App.esc(f.transactionId||"-")+'</div>'
    +remarksLine
    +'</div>'
    +'<div class="doc-footer-row" style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:16px;">'
    +'<div class="seal">Rainbow<br>Seal</div>'
    +'<div style="width:90px;height:90px;border:1px dashed #9aa5b1;display:flex;align-items:center;justify-content:center;font-size:10px;color:#657386;text-align:center;line-height:1.3;">QR Code<br>(Coming Soon)</div>'
    +'</div>'
    +'<div class="signature-row"><div>Received By</div><div>Authorized Signature</div></div>';
},

async blob(title,html){
  const wrap=document.createElement("div");
  wrap.className="pdf-page";
  wrap.innerHTML='<section class="doc ready">'+html+'</section>';
  // Any of these will silently produce a blank PDF, so all are forced
  // explicitly: display:none, zero width/height, transparent background,
  // detached-from-DOM, or an element the browser hasn't actually painted
  // yet at capture time.
  wrap.style.position="fixed";
  wrap.style.left="0";
  wrap.style.top="0";
  wrap.style.margin="0";
  wrap.style.padding="0";
  wrap.style.width="210mm";
  wrap.style.minHeight="1px";
  wrap.style.background="#ffffff";
  wrap.style.zIndex="-1";
  wrap.style.opacity="1";
  wrap.style.display="block";
  wrap.style.visibility="visible";
  wrap.style.overflow="visible";
  wrap.style.pointerEvents="none";
  document.body.appendChild(wrap);

  // Render from the actual printable section (the .doc element), not the
  // bare outer wrapper — matches what openPrint()/onscreen preview show.
  const target=wrap.querySelector(".doc")||wrap;
  target.style.display="block";
  target.style.visibility="visible";
  target.style.opacity="1";
  target.style.background="#ffffff";
  target.style.width="210mm";

  try{
    if(!window.html2pdf)return null;
    if(!document.body.contains(wrap))return null; // guard: detached DOM would capture blank

    // Wait for an actual paint cycle, then let layout/webfonts/images settle.
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    await new Promise(r=>setTimeout(r,150));

    if(target.offsetWidth===0||target.offsetHeight===0){
      console.warn("App.Pdf.blob: target has zero size — aborting instead of producing a blank PDF");
      return null;
    }

    const worker=window.html2pdf().set({
      margin:10,
      filename:App.fileName(title)+".pdf",
      image:{type:"jpeg",quality:.98},
      html2canvas:{
        scale:2,
        useCORS:true,
        allowTaint:false,
        backgroundColor:"#ffffff",
        logging:false,
        // foreignObjectRendering can silently produce a blank canvas on
        // Android Chrome / Samsung Internet — force the safer raster path
        // so this works consistently across mobile and desktop browsers.
        foreignObjectRendering:false,
        windowWidth:target.scrollWidth||target.offsetWidth,
        scrollX:0,
        scrollY:0
      },
      jsPDF:{unit:"mm",format:"a4",orientation:"portrait"}
    }).from(target);

    // Worker-chain API (never outputPdf("blob") — that path is what was
    // producing blank pages here).
    return await worker.toCanvas().toPdf().output("blob");
  }finally{
    wrap.remove();
  }
},

openPrint(title,html){const w=window.open("","_blank","width=900,height=1100");if(!w){App.toast("Popup blocked");return}w.document.write('<!doctype html><html><head><title>'+App.esc(title)+'</title><link rel="stylesheet" href="styles.css"><style>@page{size:A4;margin:10mm}body{background:#fff}.doc{display:block!important;border:0;box-shadow:none}</style></head><body><section class="doc ready">'+html+'</section></body></html>');w.document.close();setTimeout(()=>{w.focus();w.print()},350)},

async ensure(type,item,title,html,file){if(item.pdfUrl)return item.pdfUrl;const b=await this.blob(title,html);if(!b){this.openPrint(title,html);return ""}try{const url=await App.Storage.upload(type,item,b,file);if(url)App.toast("PDF Supabase Storage me save ho gayi");return url}catch(e){console.warn(e);App.toast("PDF Storage issue: documents bucket/policy check karein");return ""}},

async download(type,item,title,html,file){await this.ensure(type,item,title,html,file);const b=await this.blob(title,html);if(!b)return this.openPrint(title,html);const u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download=file;a.click();URL.revokeObjectURL(u)},

async preview(type,item,title,html,file){const u=await this.ensure(type,item,title,html,file);u?window.open(u,"_blank"):this.openPrint(title,html)},

async share(type,item,title,html,file){const url=await this.ensure(type,item,title,html,file);const b=await this.blob(title,html);if(b&&navigator.share){const f=new File([b],file,{type:"application/pdf"});if(!navigator.canShare||navigator.canShare({files:[f]})){try{await navigator.share({title,text:title+" - "+(item.studentName||"")+(url?"\n"+url:""),files:[f]});return}catch(e){if(e.name==="AbortError")return}}}if(url&&navigator.share){try{await navigator.share({title,text:title,url});return}catch{}}url?window.open(url,"_blank"):App.toast("Share support available nahi hai")},

/**
 * Shared action bar for both Admission and Receipt docs.
 * FEATURE 8 adds an explicit Print button (previously Print was only
 * reachable indirectly when html2pdf wasn't available). Save PDF / Preview /
 * Share / WhatsApp behavior is unchanged.
 */
actions(target,item,type,html){
  const title=type==="admission"?"Admission Form":"Fees Receipt";
  const file=App.fileName((type==="admission"?item.admissionId:item.receiptNo)+"-"+item.studentName)+".pdf";
  App.$(target).insertAdjacentHTML("beforeend",'<div class="actions"><button class="blue" id="'+type+'SavePdf">Save PDF</button><button class="ghost" id="'+type+'Print">Print</button><button class="ghost" id="'+type+'Preview">Preview</button><button class="green" id="'+type+'Share">Share</button><button id="'+type+'Wa">WhatsApp</button></div>');
  App.$('#'+type+'SavePdf').onclick=()=>this.download(type,item,title,html,file);
  App.$('#'+type+'Print').onclick=()=>this.openPrint(title,html);
  App.$('#'+type+'Preview').onclick=()=>this.preview(type,item,title,html,file);
  App.$('#'+type+'Share').onclick=()=>this.share(type,item,title,html,file);
  App.$('#'+type+'Wa').onclick=()=>App.whatsapp(item.mobile,type==="admission"?"Admission Form: "+item.studentName+", ID "+item.admissionId:"Receipt "+item.receiptNo+": "+item.studentName+" ki fees "+App.rs(item.total)+" receive ho gayi. - Rainbow The Learner Zone");
},

showAdmission(a){const h=this.admissionHtml(a);App.$("#admissionDoc").className="doc ready";App.$("#admissionDoc").innerHTML=h;this.actions("#admissionDoc",a,"admission",h)},

showReceipt(f){const h=this.receiptHtml(f);App.$("#receiptDoc").className="doc ready";App.$("#receiptDoc").innerHTML=h;this.actions("#receiptDoc",f,"fees",h)}

};
    +'<div style="width:90px;height:90px;border:1px dashed #9aa5b1;display:flex;align-items:center;justify-content:center;font-size:10px;color:#657386;text-align:center;line-height:1.3;">QR Code<br>(Coming Soon)</div>'
    +'</div>'
    +'<div class="signature-row"><div>Received By</div><div>Authorized Signature</div></div>';
},

async blob(title,html){
  const wrap=document.createElement("div");
  wrap.className="pdf-page";
  wrap.innerHTML='<section class="doc ready">'+html+'</section>';
  // Root cause of blank PDFs: the wrapper was appended without being
  // forced visible/laid-out, so html2canvas captured an empty/zero-size
  // element. Force it onscreen (off to the side, not overlapping the UI)
  // with real dimensions and full opacity before rendering.
  wrap.style.position="fixed";
  wrap.style.left="0";
  wrap.style.top="0";
  wrap.style.width="210mm";
  wrap.style.background="#fff";
  wrap.style.zIndex="-1";
  wrap.style.opacity="1";
  wrap.style.display="block";
  wrap.style.visibility="visible";
  document.body.appendChild(wrap);
  try{
    if(!window.html2pdf)return null;
    // Wait for the browser to actually paint the wrapper before capturing it.
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    await new Promise(r=>setTimeout(r,120));
    return await window.html2pdf().set({margin:10,filename:App.fileName(title)+".pdf",image:{type:"jpeg",quality:.98},html2canvas:{scale:2,useCORS:true,backgroundColor:"#ffffff",logging:false},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"}}).from(wrap).outputPdf("blob")
  }finally{
    wrap.remove();
  }
},

openPrint(title,html){const w=window.open("","_blank","width=900,height=1100");if(!w){App.toast("Popup blocked");return}w.document.write('<!doctype html><html><head><title>'+App.esc(title)+'</title><link rel="stylesheet" href="styles.css"><style>@page{size:A4;margin:10mm}body{background:#fff}.doc{display:block!important;border:0;box-shadow:none}</style></head><body><section class="doc ready">'+html+'</section></body></html>');w.document.close();setTimeout(()=>{w.focus();w.print()},350)},

async ensure(type,item,title,html,file){if(item.pdfUrl)return item.pdfUrl;const b=await this.blob(title,html);if(!b){this.openPrint(title,html);return ""}try{const url=await App.Storage.upload(type,item,b,file);if(url)App.toast("PDF Supabase Storage me save ho gayi");return url}catch(e){console.warn(e);App.toast("PDF Storage issue: documents bucket/policy check karein");return ""}},

async download(type,item,title,html,file){await this.ensure(type,item,title,html,file);const b=await this.blob(title,html);if(!b)return this.openPrint(title,html);const u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download=file;a.click();URL.revokeObjectURL(u)},

async preview(type,item,title,html,file){const u=await this.ensure(type,item,title,html,file);u?window.open(u,"_blank"):this.openPrint(title,html)},

async share(type,item,title,html,file){const url=await this.ensure(type,item,title,html,file);const b=await this.blob(title,html);if(b&&navigator.share){const f=new File([b],file,{type:"application/pdf"});if(!navigator.canShare||navigator.canShare({files:[f]})){try{await navigator.share({title,text:title+" - "+(item.studentName||"")+(url?"\n"+url:""),files:[f]});return}catch(e){if(e.name==="AbortError")return}}}if(url&&navigator.share){try{await navigator.share({title,text:title,url});return}catch{}}url?window.open(url,"_blank"):App.toast("Share support available nahi hai")},

/**
 * Shared action bar for both Admission and Receipt docs.
 * FEATURE 8 adds an explicit Print button (previously Print was only
 * reachable indirectly when html2pdf wasn't available). Save PDF / Preview /
 * Share / WhatsApp behavior is unchanged.
 */
actions(target,item,type,html){
  const title=type==="admission"?"Admission Form":"Fees Receipt";
  const file=App.fileName((type==="admission"?item.admissionId:item.receiptNo)+"-"+item.studentName)+".pdf";
  App.$(target).insertAdjacentHTML("beforeend",'<div class="actions"><button class="blue" id="'+type+'SavePdf">Save PDF</button><button class="ghost" id="'+type+'Print">Print</button><button class="ghost" id="'+type+'Preview">Preview</button><button class="green" id="'+type+'Share">Share</button><button id="'+type+'Wa">WhatsApp</button></div>');
  App.$('#'+type+'SavePdf').onclick=()=>this.download(type,item,title,html,file);
  App.$('#'+type+'Print').onclick=()=>this.openPrint(title,html);
  App.$('#'+type+'Preview').onclick=()=>this.preview(type,item,title,html,file);
  App.$('#'+type+'Share').onclick=()=>this.share(type,item,title,html,file);
  App.$('#'+type+'Wa').onclick=()=>App.whatsapp(item.mobile,type==="admission"?"Admission Form: "+item.studentName+", ID "+item.admissionId:"Receipt "+item.receiptNo+": "+item.studentName+" ki fees "+App.rs(item.total)+" receive ho gayi. - Rainbow The Learner Zone");
},

showAdmission(a){const h=this.admissionHtml(a);App.$("#admissionDoc").className="doc ready";App.$("#admissionDoc").innerHTML=h;this.actions("#admissionDoc",a,"admission",h)},

showReceipt(f){const h=this.receiptHtml(f);App.$("#receiptDoc").className="doc ready";App.$("#receiptDoc").innerHTML=h;this.actions("#receiptDoc",f,"fees",h)}

};
