/* Local Talk: 4-seat server-backed room admission.
   Loaded after app.js. Existing chat, notices, reports and maps are unchanged. */
(function () {
  'use strict';
  if (typeof enterSpecificChatRoom !== 'function' ||
      typeof watchRoomConnection !== 'function') return;

  var seatRef = null;
  var originalOpenRoomList = openChatRoomList;
  var originalFailedAdmission = goBackFromFailedAdmission;

  function fullError() {
    var e = new Error('All four room seats are occupied');
    e.code = 'ROOM_FULL';
    return e;
  }

  function releaseSeat(ref) {
    if (!ref) return Promise.resolve();
    return ref.transaction(function(value) {
      return value && value.uid === myUserId ? null : undefined;
    }, undefined, false).catch(function(err) {
      console.warn('Room seat release:', err);
    }).then(function() {
      return ref.onDisconnect().cancel().catch(function(err) {
        console.warn('Room seat disconnect cancel:', err);
      });
    });
  }

  function claimSeat(roomRef, token, displayName) {
    var slots = roomRef.child('slots');
    function stale() { return token !== roomJoinToken; }
    function arm(ref) {
      if (stale()) return releaseSeat(ref).then(function(){ return null; });
      return ref.onDisconnect().remove().then(function() {
        if (stale()) return releaseSeat(ref).then(function(){ return null; });
        seatRef = ref;
        return ref;
      }).catch(function(err) {
        return releaseSeat(ref).then(function(){ throw err; });
      });
    }
    if (stale()) return Promise.resolve(null);
    // After a short network interruption, the previous seat may still exist.
    var old = seatRef;
    var check = old ? old.once('value').then(function(snapshot) {
      return snapshot.val() && snapshot.val().uid === myUserId ? old : null;
    }) : Promise.resolve(null);
    return check.then(function(found) {
      if (stale()) return null;
      if (found) return arm(found);
      return slots.once('value').then(function(snapshot) {
        if (stale()) return null;
        var occupied = snapshot.val() || {};
        for (var i = 1; i <= 4; i++) {
          if (occupied[i] && occupied[i].uid === myUserId) {
            return arm(slots.child(String(i)));
          }
        }
        function attempt(i) {
          if (stale()) return Promise.resolve(null);
          if (i > 4) return Promise.reject(fullError());
          var candidate = slots.child(String(i));
          return candidate.transaction(function(value) {
            if (value !== null && value !== undefined) return;
            return {
              uid: myUserId,
              name: displayName,
              joinedAt: firebase.database.ServerValue.TIMESTAMP
            };
          }, undefined, false).then(function(result) {
            if (result.committed) return arm(candidate);
            return attempt(i + 1);
          });
        }
        return attempt(1);
      });
    });
  }

  // The UI displays the actual reservations rather than possibly-lagging
  // activeUsers presence records.
  openChatRoomList = function() {
    originalOpenRoomList();
    var ref = roomListListenerRef;
    if (!ref) return;
    ref.off('value');
    ref.on('value', function(snapshot) {
      var rooms = snapshot.val() || {};
      roomUserCounts = {};
      Object.keys(rooms).forEach(function(id) {
        roomUserCounts[id] = Object.keys((rooms[id] && rooms[id].slots) || {}).length;
      });
      renderChatRooms();
    }, function(err) {
      console.error('Room capacity listing failed:', err);
    });
  };

  enterSpecificChatRoom = function(roomId) {
    if (!requireAuth()) return;
    if (!userCountry || !userNickname) {
      openProfileModal();
      return;
    }
    if ((roomUserCounts[roomId] || 0) >= 4) {
      alert(uiText('roomFullAlert'));
      return;
    }
    stopRoomListeners();
    if (currentRoomUsersRef) leaveCurrentRoom();
    if (roomListListenerRef) {
      roomListListenerRef.off();
      roomListListenerRef = null;
    }

    currentRoom = roomId;
    roomJoinToken++;
    roomPreviousUsers = null;
    roomNoticeQueue = [];
    roomLatestMessages = [];
    roomEntryMessageKeys = new Set();
    roomHistoryReady = false;
    roomAdmissionReady = false;
    currentView = 'chat';

    var displayName = userCountry.split(' ')[0] + ' ' + userNickname;
    var joiningRef = db.ref('rooms/' + currentCity.id + '/' + roomId + '/activeUsers/' + myUserId);
    currentRoomUsersRef = joiningRef;
    var token = roomJoinToken;
    var baseRef = joiningRef.parent.parent;

    roomLeaveInFlight.then(function() {
      if (token !== roomJoinToken) return null;
      return joiningRef.onDisconnect().remove();
    }).then(function() {
      if (token !== roomJoinToken) return null;
      // Only delete stale message history if neither occupancy nor
      // reservations exist. Do not delete another concurrent user's messages.
      return Promise.all([
        joiningRef.parent.once('value'),
        baseRef.child('slots').once('value')
      ]).then(function(items) {
        if (token !== roomJoinToken) return;
        if (!items[0].exists() && !items[1].exists()) {
          return baseRef.child('messages').remove().catch(function(err) {
            console.warn('Stale chat cleanup skipped:', err);
          });
        }
      });
    }).then(function() {
      if (token !== roomJoinToken) return null;
      return baseRef.child('messages').once('value');
    }).then(function(snapshot) {
      if (!snapshot || token !== roomJoinToken) return null;
      roomEntryMessageKeys = new Set(Object.keys(snapshot.val() || {}));
      roomHistoryReady = true;
      renderMessages(roomLatestMessages || []);
      return claimSeat(baseRef, token, displayName);
    }).then(function(claimed) {
      if (token !== roomJoinToken || !claimed) return null;
      return joiningRef.set({
        name: displayName,
        joinedAt: firebase.database.ServerValue.TIMESTAMP
      });
    }).then(function() {
      if (token === roomJoinToken && seatRef) {
        roomAdmissionReady = true;
        watchRoomConnection(joiningRef, token, displayName);
      }
    }).catch(function(err) {
      if (token !== roomJoinToken) return;
      console.error('Room admission failed:', err);
      alert(err && err.code === 'ROOM_FULL' ?
        uiText('roomFullAlert') : uiText('roomJoinFailed'));
      goBackFromFailedAdmission();
    });

    document.getElementById('roomListView').classList.add('hidden');
    document.getElementById('mapView').classList.add('hidden');
    document.getElementById('chatView').classList.remove('hidden');
    document.getElementById('chatView').classList.add('flex');
    var cityName = getCityName(currentCity);
    var t = I18N[currentLang] || I18N.ko;
    document.getElementById('headerTitle').innerText = cityName + ' Room #' + roomId;
    document.getElementById('chatNoticeTitle').innerText = cityName + ' Room #' + roomId + ' Q&A';
    document.getElementById('chatNoticeSub').innerText = t.noticeSub;
    listenRoomPresence();
    listenRealtimeMessages();
  };

  // Firebase onDisconnect is one-shot. Re-register both cleanup paths when
  // Android resumes; if all four seats are taken by then, refuse re-admission.
  watchRoomConnection = function(joiningRef, token, displayName) {
    if (roomConnectionRef && roomConnectionCallback)
      roomConnectionRef.off('value', roomConnectionCallback);
    roomConnectionRef = db.ref('.info/connected');
    roomConnectionCallback = function(snapshot) {
      if (token !== roomJoinToken || currentRoomUsersRef !== joiningRef) return;
      if (snapshot.val() !== true) {
        roomAdmissionReady = false;
        return;
      }
      if (roomReconnectBusy) return;
      roomReconnectBusy = true;
      claimSeat(joiningRef.parent.parent, token, displayName).then(function(claimed) {
        if (!claimed || token !== roomJoinToken || currentRoomUsersRef !== joiningRef) return;
        return joiningRef.onDisconnect().remove().then(function() {
          if (token !== roomJoinToken || currentRoomUsersRef !== joiningRef) return;
          return joiningRef.once('value').then(function(user) {
            if (token !== roomJoinToken || currentRoomUsersRef !== joiningRef) return;
            if (!user.exists()) {
              return joiningRef.set({
                name: displayName,
                joinedAt: firebase.database.ServerValue.TIMESTAMP
              });
            }
          });
        });
      }).then(function() {
        if (token === roomJoinToken && currentRoomUsersRef === joiningRef && seatRef)
          roomAdmissionReady = true;
      }).catch(function(err) {
        console.error('Room seat reconnect failed:', err);
        roomAdmissionReady = false;
        if (token === roomJoinToken && err && err.code === 'ROOM_FULL') {
          alert(uiText('roomFullAlert'));
          goBackFromFailedAdmission();
        }
      }).then(function() { roomReconnectBusy = false; });
    };
    roomConnectionRef.on('value', roomConnectionCallback);
  };

  leaveCurrentRoom = function() {
    if (!currentRoomUsersRef) return roomLeaveInFlight;
    var leavingRef = currentRoomUsersRef;
    var released = seatRef;
    currentRoomUsersRef = null;
    seatRef = null;
    // Preserve an immediate notice for deliberate exits.
    roomLeaveInFlight = leavingRef.child('joinedAt').set(0).catch(function(err) {
      console.warn('Room exit marker skipped:', err);
    }).then(function() {
      return leavingRef.remove();
    }).then(function() {
      return leavingRef.onDisconnect().cancel();
    }).then(function() {
      return releaseSeat(released);
    }).then(function() {
      return Promise.all([
        leavingRef.parent.once('value'),
        leavingRef.parent.parent.child('slots').once('value')
      ]);
    }).then(function(data) {
      if (!data[0].exists() && !data[1].exists()) {
        return leavingRef.parent.parent.child('messages').remove().catch(function(err) {
          console.warn('Last-room history cleanup skipped:', err);
        });
      }
    }).catch(function(err) {
      console.error('Room exit failed:', err);
    });
    return roomLeaveInFlight;
  };

  goBackFromFailedAdmission = function() {
    // Do not leave an acquired seat behind after a partially failed entry.
    leaveCurrentRoom();
    originalFailedAdmission();
  };
}());
