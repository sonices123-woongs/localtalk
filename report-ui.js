/* Local Talk · branded report dialog for community posts/comments.
   Report payloads and Firebase paths intentionally match app.js.
   Browser prompt/alert titles are owned by the browser and cannot be renamed. */
(function () {
  'use strict';
  if (typeof window.submitCommunityReport !== 'function' ||
      typeof window.submitSafetyReport !== 'function') return;

  var modal = null;
  var toast = null;
  var current = null;
  var chosenReason = null;
  var busy = false;
  var returnFocus = null;
  var toastTimer = null;

  var translations = {
    ko: {
      kicker: 'Local Talk · 커뮤니티 보호',
      title: '신고하기',
      description: '신고 사유를 선택해 주세요. 운영자가 내용을 확인합니다.',
      targetPost: '신고할 게시글',
      targetComment: '신고할 댓글',
      select: '신고 사유',
      cancel: '취소',
      submit: '신고 접수',
      sending: '접수 중...',
      choose: '신고 사유를 먼저 선택해 주세요.',
      close: '신고 창 닫기',
      toastTitle: 'Local Talk',
      fallback: '신고할 내용',
      note: '신고만으로 콘텐츠가 즉시 삭제되지는 않습니다.'
    },
    en: {
      kicker: 'Local Talk · Community safety',
      title: 'Report content',
      description: 'Choose a reason. Our moderators will review the report.',
      targetPost: 'Reported post',
      targetComment: 'Reported comment',
      select: 'Reason for reporting',
      cancel: 'Cancel',
      submit: 'Submit report',
      sending: 'Submitting...',
      choose: 'Please select a reason.',
      close: 'Close report dialog',
      toastTitle: 'Local Talk',
      fallback: 'Reported content',
      note: 'Submitting a report does not immediately remove content.'
    },
    ja: {
      kicker: 'Local Talk · 安全管理',
      title: '通報する',
      description: '理由を選択してください。運営者が内容を確認します。',
      targetPost: '通報する投稿',
      targetComment: '通報するコメント',
      select: '通報理由',
      cancel: 'キャンセル',
      submit: '通報を送信',
      sending: '送信中...',
      choose: '通報理由を選択してください。',
      close: '通報画面を閉じる',
      toastTitle: 'Local Talk',
      fallback: '通報する内容',
      note: '通報した内容がすぐに削除されるとは限りません。'
    },
    'zh-CN': {
      kicker: 'Local Talk · 社区安全',
      title: '举报内容',
      description: '请选择举报原因。管理员将进行审核。',
      targetPost: '举报帖子',
      targetComment: '举报评论',
      select: '举报原因',
      cancel: '取消',
      submit: '提交举报',
      sending: '提交中...',
      choose: '请先选择举报原因。',
      close: '关闭举报窗口',
      toastTitle: 'Local Talk',
      fallback: '举报内容',
      note: '提交举报不会立即删除内容。'
    }
  };
  function copy() { return translations[currentLang] || translations.ko; }

  function make(tag, className, textValue) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (textValue != null) e.textContent = textValue;
    return e;
  }
  function styleOnce() {
    if (document.getElementById('lt-report-styles')) return;
    var style = document.createElement('style');
    style.id = 'lt-report-styles';
    style.textContent = [
      '.lt-report-overlay{position:fixed;inset:0;z-index:12000;background:rgba(15,23,42,.7);display:flex;justify-content:center;align-items:center;padding:16px;box-sizing:border-box;backdrop-filter:blur(3px)}',
      '.lt-report-overlay[hidden]{display:none!important}',
      '.lt-report-panel{box-sizing:border-box;width:min(100%,410px);max-height:calc(100dvh - 32px);overflow-y:auto;border-radius:22px;background:#fff;box-shadow:0 24px 60px rgba(15,23,42,.3);padding:22px;color:#1e293b}',
      '.lt-report-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}',
      '.lt-report-kicker{font-size:11px;font-weight:750;color:#6366f1;letter-spacing:.025em}',
      '.lt-report-title{font-size:21px;font-weight:850;line-height:1.28;margin:6px 0 0}',
      '.lt-report-x{flex:0 0 auto;border-radius:10px;background:#f1f5f9;border:0;color:#475569;cursor:pointer;font-size:19px;min-width:36px;min-height:36px}',
      '.lt-report-desc{font-size:13px;color:#64748b;margin-top:12px;line-height:1.6}',
      '.lt-report-target{margin-top:15px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:13px;padding:12px}',
      '.lt-report-target-label{font-size:11px;font-weight:750;color:#64748b}',
      '.lt-report-target-text{font-size:13px;font-weight:650;line-height:1.5;color:#334155;margin-top:5px;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}',
      '.lt-report-reason-title{font-size:13px;font-weight:800;color:#334155;margin:18px 0 9px}',
      '.lt-report-reasons{display:grid;gap:8px}',
      '.lt-report-choice{width:100%;display:flex;align-items:center;gap:11px;padding:12px 13px;border:1px solid #e2e8f0;border-radius:13px;background:#fff;text-align:left;cursor:pointer;font:inherit;font-size:14px;font-weight:650;color:#334155;min-height:46px}',
      '.lt-report-choice-dot{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex:0 0 20px;border:2px solid #cbd5e1;border-radius:50%;color:white;font-size:12px}',
      '.lt-report-choice[aria-pressed=true]{background:#eef2ff;color:#4338ca;border-color:#818cf8}',
      '.lt-report-choice[aria-pressed=true] .lt-report-choice-dot{border-color:#4f46e5;background:#4f46e5}',
      '.lt-report-choice:focus-visible,.lt-report-x:focus-visible,.lt-report-cancel:focus-visible,.lt-report-send:focus-visible{outline:3px solid #a5b4fc;outline-offset:2px}',
      '.lt-report-note{font-size:11px;color:#94a3b8;line-height:1.5;margin-top:12px}',
      '.lt-report-actions{display:flex;gap:10px;margin-top:19px}',
      '.lt-report-cancel,.lt-report-send{flex:1;border:0;border-radius:12px;min-height:44px;padding:11px 12px;font-size:13px;font-weight:800;cursor:pointer}',
      '.lt-report-cancel{background:#f1f5f9;color:#475569}',
      '.lt-report-send{background:#4f46e5;color:#fff}',
      '.lt-report-send:disabled{opacity:.55;cursor:not-allowed}',
      '.lt-report-toast{position:fixed;z-index:12500;top:18px;left:50%;transform:translateX(-50%);width:min(90vw,390px);box-sizing:border-box;background:white;box-shadow:0 12px 32px rgba(15,23,42,.26);border:1px solid #e2e8f0;border-left:4px solid #10b981;border-radius:13px;padding:13px 15px;display:flex;gap:11px;align-items:center;color:#0f172a}',
      '.lt-report-toast[hidden]{display:none!important}',
      '.lt-report-toast[data-kind=error]{border-left-color:#ef4444}',
      '.lt-report-toast-icon{font-size:19px;color:#059669}',
      '.lt-report-toast[data-kind=error] .lt-report-toast-icon{color:#dc2626}',
      '.lt-report-toast-title{font-size:12px;font-weight:850;color:#4338ca}',
      '.lt-report-toast-message{font-size:13px;color:#334155;margin-top:2px}',
      '@media(max-width:390px){.lt-report-panel{padding:18px}.lt-report-choice{padding:10px 11px}}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function showToast(message, kind) {
    styleOnce();
    if (!toast) {
      toast = make('div','lt-report-toast');
      toast.setAttribute('role','status');
      toast.setAttribute('aria-live','polite');
      var icon = make('span','lt-report-toast-icon');
      icon.setAttribute('aria-hidden','true');
      var words = make('div','');
      words.appendChild(make('div','lt-report-toast-title'));
      words.appendChild(make('div','lt-report-toast-message'));
      toast.appendChild(icon);
      toast.appendChild(words);
      document.body.appendChild(toast);
    }
    var children = toast.children;
    children[0].textContent = kind === 'error' ? '!' : '✓';
    children[1].children[0].textContent = copy().toastTitle;
    children[1].children[1].textContent = message;
    toast.dataset.kind = kind || 'success';
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ if (toast) toast.hidden = true; }, 4100);
  }

  function dismiss() {
    if (busy || !modal) return;
    modal.hidden = true;
    current = null;
    chosenReason = null;
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  function openDialog(payload) {
    styleOnce();
    if (!modal) {
      modal = make('div','lt-report-overlay');
      modal.hidden = true;
      modal.setAttribute('role','dialog');
      modal.setAttribute('aria-modal','true');
      modal.setAttribute('aria-labelledby','ltReportHeading');
      modal.addEventListener('click',function(e){if (e.target===modal) dismiss();});
      document.body.appendChild(modal);
    }
    current = payload;
    chosenReason = null;
    busy = false;
    returnFocus = document.activeElement;
    modal.replaceChildren();
    var panel = make('div','lt-report-panel');
    var header = make('div','lt-report-top');
    var titleGroup = make('div','');
    titleGroup.appendChild(make('div','lt-report-kicker',copy().kicker));
    var heading = make('h2','lt-report-title',copy().title);
    heading.id = 'ltReportHeading';
    titleGroup.appendChild(heading);
    var exit = make('button','lt-report-x','×');
    exit.type='button';
    exit.setAttribute('aria-label',copy().close);
    exit.addEventListener('click',dismiss);
    header.appendChild(titleGroup);
    header.appendChild(exit);
    panel.appendChild(header);
    panel.appendChild(make('p','lt-report-desc',copy().description));
    var excerpt = make('div','lt-report-target');
    excerpt.appendChild(make('div','lt-report-target-label',
      payload.kind==='comment'?copy().targetComment:copy().targetPost));
    excerpt.appendChild(make('div','lt-report-target-text',payload.contentText.slice(0,180)||copy().fallback));
    panel.appendChild(excerpt);
    var reasonHeading = make('div','lt-report-reason-title',copy().select);
    panel.appendChild(reasonHeading);
    var reasons = make('div','lt-report-reasons');
    reasons.setAttribute('role','group');
    reasons.setAttribute('aria-label',copy().select);
    var buttons = [];
    safetyText().reasons.forEach(function(text,i){
      var btn = make('button','lt-report-choice');
      btn.type='button';
      btn.setAttribute('aria-pressed','false');
      var circle = make('span','lt-report-choice-dot');
      circle.setAttribute('aria-hidden','true');
      var label = make('span','',text);
      btn.appendChild(circle); btn.appendChild(label);
      btn.addEventListener('click',function(){
        chosenReason=String(i);
        buttons.forEach(function(other){
          var selected=other===btn;
          other.setAttribute('aria-pressed',String(selected));
          other.firstChild.textContent=selected?'✓':'';
        });
        confirmBtn.disabled=false;
      });
      buttons.push(btn);
      reasons.appendChild(btn);
    });
    panel.appendChild(reasons);
    panel.appendChild(make('p','lt-report-note',copy().note));
    var actions = make('div','lt-report-actions');
    var cancelBtn = make('button','lt-report-cancel',copy().cancel);
    cancelBtn.type='button';
    cancelBtn.addEventListener('click',dismiss);
    var confirmBtn = make('button','lt-report-send',copy().submit);
    confirmBtn.type='button';
    confirmBtn.disabled=true;
    confirmBtn.addEventListener('click',function(){
      if (busy || !current) return;
      if (chosenReason===null) { showToast(copy().choose,'error');return; }
      // Keep the exact field schema / report path already used by app.js.
      var info = current;
      var report = {
        reporterUid:myUserId, reportedUid:info.targetUid, cityId:info.cityId,
        kind:info.kind, postId:info.postId,
        commentId:info.kind==='comment'?info.commentId:'',
        reason:chosenReason,
        contentText:info.contentText.slice(0,2000),
        sender:info.sender.slice(0,100),
        createdAt:firebase.database.ServerValue.TIMESTAMP
      };
      busy=true;
      confirmBtn.disabled=true;
      cancelBtn.disabled=true;
      exit.disabled=true;
      buttons.forEach(function(b){b.disabled=true;});
      confirmBtn.textContent=copy().sending;
      db.ref('communityReports').push().set(report).then(function(){
        busy=false;
        dismiss();
        showToast(safetyText().success,'success');
      }).catch(function(error){
        console.error('Community report failed',error);
        busy=false;
        confirmBtn.disabled=false;
        cancelBtn.disabled=false;
        exit.disabled=false;
        buttons.forEach(function(b){b.disabled=false;});
        confirmBtn.textContent=copy().submit;
        showToast(safetyText().error,'error');
      });
    });
    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    panel.appendChild(actions);
    modal.appendChild(panel);
    modal.hidden=false;
    exit.focus();
  }

  document.addEventListener('keydown',function(e){
    if (!modal || modal.hidden) return;
    if (e.key === 'Escape'){e.preventDefault();dismiss();return;}
    if (e.key === 'Tab') {
      var focusable=Array.prototype.slice.call(modal.querySelectorAll('button:not([disabled])'));
      if (!focusable.length)return;
      var idx=focusable.indexOf(document.activeElement);
      if(e.shiftKey && idx<=0){e.preventDefault();focusable[focusable.length-1].focus();}
      else if(!e.shiftKey && idx===focusable.length-1){e.preventDefault();focusable[0].focus();}
    }
  });

  // Original callbacks created by app.js resolve this function when clicked.
  window.submitCommunityReport = function(kind,postId,commentId){
    if (busy || !requireAuth() || !currentCity) return;
    var post=communityData[postId];
    var target=kind==='comment'?(post&&post.comments&&post.comments[commentId]):post;
    if (!target || !target.uid || target.uid===myUserId) return;
    openDialog({
      kind:kind,
      cityId:currentCity.id,
      postId:postId,
      commentId:commentId,
      targetUid:target.uid,
      contentText:String(kind==='comment'?target.text:(String(target.title||'')+'\n'+String(target.body||''))),
      sender:String(target.author||'')
    });
  };

  // Chat already has a proper in-app reason selector; only replace its
  // native success/error alerts with matching branded notifications.
  window.submitSafetyReport = function(){
    if (!safetySelectedMessage || !requireAuth()) return;
    var m=safetySelectedMessage;
    var reason=document.getElementById('safetyReason').value;
    var btn=document.getElementById('safetyReport');
    if (!btn || btn.disabled) return;
    btn.disabled=true;
    db.ref('reports').push().set({
      reporterUid:myUserId, reportedUid:m.uid, cityId:m.city,
      roomId:m.room, messageId:m.id, reason:reason,
      messageText:m.text.slice(0,2000), sender:m.sender.slice(0,100),
      createdAt:firebase.database.ServerValue.TIMESTAMP
    }).then(function(){
      closeSafetyModal();
      showToast(safetyText().success,'success');
    }).catch(function(error){
      console.error('Chat report failed',error);
      showToast(safetyText().error,'error');
    }).finally(function(){btn.disabled=false;});
  };
}());
