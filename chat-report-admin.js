/* Local Talk - administrator actions for chat-message reports.
   Loaded after app.js; existing community report handling stays untouched. */
(function () {
  'use strict';
  if (typeof openAdminReports !== 'function' || typeof renderAdminReports !== 'function') return;

  var originalOpen = openAdminReports;
  var originalRender = renderAdminReports;
  var chatStatuses = null;
  var statusError = '';
  var requestVersion = 0;

  function isValidKey(key) {
    return typeof key === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(key);
  }

  function appendNote(card, message, error) {
    var note = document.createElement('p');
    note.className = error ? 'text-xs text-red-700' : 'text-xs text-slate-500';
    note.textContent = message;
    card.appendChild(note);
  }

  openAdminReports = function () {
    var version = ++requestVersion;
    chatStatuses = null;
    statusError = '';
    originalOpen();
    if (!officialIsAdmin || !auth.currentUser) return;

    db.ref('chatReportStatuses').once('value').then(function (snapshot) {
      if (version !== requestVersion) return;
      chatStatuses = snapshot.val() || {};
    }).catch(function (error) {
      if (version !== requestVersion) return;
      statusError = String((error && error.code) || 'unknown');
      console.error('Chat report status read failed', error);
    }).then(function () {
      var modal = document.getElementById('adminReportsModal');
      if (version === requestVersion && modal && !modal.classList.contains('hidden')) {
        renderAdminReports();
      }
    });
  };

  renderAdminReports = function () {
    originalRender();
    var root = document.getElementById('adminReportsList');
    if (!root || !officialIsAdmin) return;
    var cards = Array.prototype.filter.call(root.children, function (child) {
      return child.tagName === 'DIV' && child.classList.contains('border');
    });
    var items = adminReportItems || [];
    var pending = 0;
    items.forEach(function (item, index) {
      if (!item || item.source !== 'chat' || !cards[index]) return;
      var card = cards[index];
      var priorNote = card.querySelector('p.text-amber-800');
      if (priorNote) priorNote.remove();

      var status = chatStatuses && chatStatuses[item.id];
      if (status) {
        appendNote(card, '처리: ' + (status.action === 'deleted' ? '메시지 삭제' : '검토 완료'), false);
        return;
      }
      if (statusError) {
        appendNote(card, '신고 처리 기록 접근 실패 (' + statusError +
          '). Firebase chatReportStatuses 규칙을 먼저 게시해 주세요.', true);
        return;
      }
      if (chatStatuses === null) {
        appendNote(card, '신고 처리 기록 확인 중...', false);
        return;
      }

      pending++;
      var actions = document.createElement('div');
      actions.className = 'flex gap-2 flex-wrap';
      var review = document.createElement('button');
      review.type = 'button';
      review.className = 'px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs';
      review.textContent = '검토 완료 (삭제 안 함)';
      review.addEventListener('click', function () { resolveChatReport(item, 'reviewed'); });
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'px-3 py-2 rounded-lg bg-red-600 text-white text-xs';
      remove.textContent = '신고 메시지 삭제';
      remove.addEventListener('click', function () { resolveChatReport(item, 'deleted'); });
      actions.appendChild(review);
      actions.appendChild(remove);
      card.appendChild(actions);
    });
    var countLabel = document.getElementById('adminReportCount');
    if (countLabel && chatStatuses !== null && !statusError) {
      countLabel.textContent += ' · 채팅 미처리 ' + pending + '건';
    }
  };

  function resolveChatReport(item, action) {
    if (!officialIsAdmin || !auth.currentUser || !chatStatuses || statusError) return;
    if (!item || item.source !== 'chat' || (action !== 'reviewed' && action !== 'deleted')) return;
    var reported = item.data || {};
    var reportId = item.id;
    var roomId = String(reported.roomId == null ? '' : reported.roomId);
    if (!isValidKey(reportId) || !isValidKey(reported.cityId) ||
        !isValidKey(roomId) || !isValidKey(reported.messageId) ||
        !isValidKey(reported.reportedUid)) {
      alert('신고의 메시지 식별 정보가 올바르지 않아 처리를 중단합니다.');
      return;
    }

    var reportPath = 'reports/' + reportId;
    var statusPath = 'chatReportStatuses/' + reportId;
    Promise.all([
      db.ref(reportPath).once('value'),
      db.ref(statusPath).once('value')
    ]).then(function (snapshots) {
      var stored = snapshots[0].val();
      if (!stored || snapshots[1].exists()) {
        alert('신고가 없거나 이미 처리되었습니다. 신고관리를 다시 열어주세요.');
        return;
      }
      if (stored.cityId !== reported.cityId ||
          String(stored.roomId) !== roomId ||
          stored.messageId !== reported.messageId ||
          stored.reportedUid !== reported.reportedUid ||
          stored.messageText !== reported.messageText) {
        alert('신고 원본과 표시된 내용이 다릅니다. 처리를 중단합니다.');
        return;
      }

      var status = {
        adminUid: auth.currentUser.uid,
        action: action,
        cityId: stored.cityId,
        roomId: String(stored.roomId),
        messageId: stored.messageId,
        reportedUid: stored.reportedUid,
        createdAt: firebase.database.ServerValue.TIMESTAMP
      };

      if (action === 'reviewed') {
        if (!confirm('이 신고를 검토 완료로 표시할까요? 메시지는 그대로 유지됩니다.')) return;
        return db.ref(statusPath).set(status).then(function () { openAdminReports(); });
      }

      var messagePath = 'rooms/' + stored.cityId + '/' + String(stored.roomId) +
        '/messages/' + stored.messageId;
      return db.ref(messagePath).once('value').then(function (snapshot) {
        var message = snapshot.val();
        if (!message) {
          alert('원본 메시지가 이미 사라졌습니다. 삭제 대신 검토 완료로 처리해 주세요.');
          return;
        }
        if (message.uid !== stored.reportedUid ||
            message.text !== stored.messageText ||
            message.id !== stored.messageId) {
          alert('작성자 또는 메시지 내용이 원본 신고와 다릅니다. 삭제하지 않았습니다.');
          return;
        }
        if (!confirm('신고 메시지를 실제로 삭제할까요?\n\n' +
                     String(message.text).slice(0,120) + '\n\n삭제 후에는 되돌릴 수 없습니다.')) return;
        var changes = {};
        changes[messagePath] = null;
        changes[statusPath] = status;
        return db.ref().update(changes).then(function () { openAdminReports(); });
      });
    }).catch(function (error) {
      console.error('Chat report moderation failed', error);
      alert('신고 처리에 실패했습니다. Firebase 권한과 원본 메시지 상태를 확인해 주세요.');
    });
  }
}());
