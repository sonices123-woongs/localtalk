/* Local Talk · light, Discord-inspired room-list presentation.
   Visual-only enhancement: keep app.js admission, exit and Firebase rules unchanged. */
(function () {
  'use strict';
  if (typeof openChatRoomList !== 'function' ||
      typeof renderChatRooms !== 'function') return;

  var existingOpenChatRoomList = openChatRoomList;
  var participantsByRoom = Object.create(null);

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch) {
      return {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[ch];
    });
  }

  function localText() {
    return ({
      ko: {empty:'아직 참여자가 없어요',active:'참여자가 있는 대화방',idle:'현재 비어 있는 대화방',more:'명 더'},
      en: {empty:'No one here yet',active:'Room with participants',idle:'Empty room',more:'more'},
      ja: {empty:'まだ参加者はいません',active:'参加者がいるルーム',idle:'参加者がいないルーム',more:'人追加'},
      'zh-CN': {empty:'目前没有参与者',active:'有参与者的聊天室',idle:'空聊天室',more:'人'}
    })[currentLang] || {empty:'No one here yet',active:'Room with participants',idle:'Empty room',more:'more'};
  }

  function membersMarkup(names, copy) {
    if (!names || !names.length) {
      return '<span class="lt-room-empty-note">' + escapeHtml(copy.empty) + '</span>';
    }
    var visible = names.slice(0,3);
    return visible.map(function(full) {
      var label = String(full || '').trim();
      // Stored presence names usually begin with the user's selected flag.
      var pieces = label.split(/\s+/);
      var flag = /^[\u{1F1E6}-\u{1F1FF}]{2}$/u.test(pieces[0]) ? pieces.shift() : '👤';
      var nickname = pieces.join(' ') || label;
      return '<span class="lt-room-member" title="' + escapeHtml(label) + '">' +
        '<span class="lt-room-member-avatar" aria-hidden="true">' + escapeHtml(flag) + '</span>' +
        '<span class="lt-room-member-name">' + escapeHtml(nickname) + '</span>' +
      '</span>';
    }).join('<span class="lt-room-member-dot" aria-hidden="true">·</span>') +
      (names.length > visible.length ?
        '<span class="lt-room-member-more">+' + (names.length-visible.length) + '</span>' : '');
  }

  // Replace presentation only. Existing enterSpecificChatRoom() stays untouched.
  renderChatRooms = function() {
    var container = document.getElementById('chatRoomsContainer');
    if (!container) return;
    var t = I18N[currentLang] || I18N.ko;
    var copy = localText();
    var parts = [];
    for (var id=1; id<=5; id++) {
      var count = roomUserCounts[id] || 0;
      var active = count > 0;
      var full = count >= 4;
      var label = count + '/4' + (currentLang === 'ko' ? '' : ' ') +
        (full ? uiText('roomFullShort') : uiText('roomOccupancy'));
      var btn = full
        ? '<button type="button" class="lt-room-enter lt-room-enter-disabled" disabled>' +
          escapeHtml(uiText('roomFullShort')) + '</button>'
        : '<button type="button" class="lt-room-enter" onclick="enterSpecificChatRoom(' + id + ')">' +
          escapeHtml(t.roomEnter) + '</button>';
      var icon = active ? 'fa-volume-high' : 'fa-volume-xmark';
      var speakerText = active ? copy.active : copy.idle;
      var memberNames = participantsByRoom[id] || [];
      parts.push(
        '<article class="lt-room-card' + (active?' lt-room-has-people':' lt-room-no-people') + '">' +
          '<span class="lt-room-speaker" role="img" aria-label="' + escapeHtml(speakerText) +
            '" title="' + escapeHtml(speakerText) + '">' +
            '<i class="fas ' + icon + '" aria-hidden="true"></i>' +
            (active ? '<span class="lt-room-live-dot" aria-hidden="true"></span>' : '') +
          '</span>' +
          '<div class="lt-room-body">' +
            '<h4 class="lt-room-title">Room #' + id + '</h4>' +
            '<span class="lt-room-count ' + (full?'lt-room-count-full':(active?'lt-room-count-online':'lt-room-count-empty')) +
              '">' + escapeHtml(label) + '</span>' +
            '<div class="lt-room-members">' + membersMarkup(memberNames,copy) + '</div>' +
          '</div>' +
          btn +
        '</article>'
      );
    }
    container.classList.add('lt-room-list');
    container.innerHTML = parts.join('');
  };

  // Read the existing room presence snapshot for visible nicknames.
  // Keep the original counter listener and entry/exit flows unchanged.
  openChatRoomList = function() {
    participantsByRoom = Object.create(null);
    existingOpenChatRoomList();
    var ref = roomListListenerRef;
    if (!ref || currentView !== 'roomList') return;
    ref.on('value', function(snapshot) {
      if (roomListListenerRef !== ref || currentView !== 'roomList') return;
      var rooms = snapshot.val() || {};
      var next = Object.create(null);
      for (var id=1; id<=5; id++) {
        var active = rooms[id] && rooms[id].activeUsers || {};
        next[id] = Object.keys(active).filter(function(uid) {
          return active[uid] && active[uid].joinedAt !== 0;
        }).map(function(uid) {
          return String(active[uid].name || '').trim();
        }).filter(Boolean).slice(0,4);
      }
      participantsByRoom = next;
      renderChatRooms();
    }, function(error) {
      console.warn('Room list participant preview unavailable:', error);
    });
  };
}());
