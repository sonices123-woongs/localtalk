    var firebaseConfig = {
      apiKey: "AIzaSyAFJzrygiDq_64TLCNi86VE5nmLKivq_Y8",
      authDomain: "local-talk-6c171.firebaseapp.com",
      projectId: "local-talk-6c171",
      storageBucket: "local-talk-6c171.firebasestorage.app",
      messagingSenderId: "1088072869168",
      appId: "1:1088072869168:web:88417cb6c4eb9b623654f5",
      databaseURL: "https://local-talk-6c171-default-rtdb.firebaseio.com"
    };

    firebase.initializeApp(firebaseConfig);
    var db = firebase.database();

    // The Firebase Auth UID, not a localStorage value, is the trusted user ID.
    var auth = firebase.auth();
    var myUserId = null;
    var authReady = false;
    var cityPresenceRef = null;
    var cityPresenceListenerRef = null;
    var roomListListenerRef = null;
    var roomPreviousUsers = null;
    var roomNoticeQueue = [];
    var roomNoticeSeq = 0;
    var roomLatestMessages = [];
    var roomEntryMessageKeys = new Set();
    var roomHistoryReady = false;
    var roomJoinToken = 0;

    function requireAuth() {
      if (authReady && auth.currentUser && myUserId === auth.currentUser.uid) return true;
      alert(uiText('authWait'));
      return false;
    }

    function startAnonymousAuth() {
      var status = document.getElementById('authStatus');
      document.getElementById('authStatusText').textContent = uiText('authConnecting');
      document.getElementById('authRetry').classList.add('hidden');
      status.classList.remove('hidden');
      auth.signInAnonymously().catch(function(error) {
        console.error('Firebase authentication failed:', error.code);
        document.getElementById('authStatusText').textContent = uiText('authFailed') + ' (' + error.code + ')';
        document.getElementById('authRetry').classList.remove('hidden');
      });
    }

    auth.onAuthStateChanged(function(user) {
      if (!user) {
        authReady = false;
        myUserId = null;
        startAnonymousAuth();
        return;
      }
      if (authReady && myUserId === user.uid) return;
      if (myUserId && myUserId !== user.uid) profileRestoreStarted = false;
      myUserId = user.uid;
      authReady = true;
      document.getElementById('authStatus').classList.add('hidden');
      restoreProfileAfterAuth();
      listenCityUsers();
      refreshOfficialAdmin();
    }, function(error) {
      authReady = false;
      console.error('Auth state error:', error);
      document.getElementById('authStatusText').textContent = uiText('authStateFailed');
      document.getElementById('authRetry').classList.remove('hidden');
    });

    var userCountry = localStorage.getItem('my_user_country') || '';
    var userNickname = localStorage.getItem('my_user_nickname') || '';

    var googleApiKey = "AIzaSyCDcZIBFRMNB6xXVYO58i6WwMVxEulQqa4";
    var currentLang = ['ko','en','ja','zh-CN'].includes(localStorage.getItem('localtalk_ui_lang')) ? localStorage.getItem('localtalk_ui_lang') : 'ko';
    var autoTranslateEnabled = localStorage.getItem('localtalk_auto_translate') !== 'off';
    var translationCache = new Map();
    var translationPending = new Map();
    var translationEpoch = 0;
    var translationRoomKey = '';
    var TRANSLATION_CACHE_LIMIT = 300;
    var currentCity = null;
    var currentRoom = null;
    var currentView = 'home';

    var googleMapInstance = null;
    var googleMapMarkers = [];
    var searchMarkers = [];
    var myLocationMarker = null;
    var myLocationInfoWindow = null;
    var userLatLng = null;
    var mapLocationRequestBusy = false;
    var mapLocationTranslations = {
      ko: {checking:'📍 현재 위치를 확인하고 있어요. 휴대폰에 권한 요청이 나오면 허용해 주세요.',success:'📍 현재 위치를 지도에 표시했어요.',unsupported:'이 환경에서는 위치 확인을 지원하지 않아요.',insecure:'보안 연결(HTTPS)이 아니어서 위치 확인이 제한됐어요.',denied:'위치 접근이 거부됐어요. 휴대폰의 Local Talk 앱 위치 권한 또는 브라우저의 사이트 위치 권한을 확인해 주세요.',timeout:'위치를 확인하는 데 시간이 오래 걸려 중단됐어요. 위치 서비스를 켜고 다시 눌러 주세요.',unavailable:'휴대폰 위치 서비스를 켜고 앱 위치 권한을 확인한 뒤 다시 시도해 주세요.'},
      en: {checking:'📍 Finding your location. Allow the location permission if prompted.',success:'📍 Your location is shown on the map.',unsupported:'Location is not supported here.',insecure:'Location requires a secure HTTPS connection.',denied:'Location permission was denied. Check the app permission or this site’s browser permission.',timeout:'Location request timed out. Enable device location and try again.',unavailable:'Check device location services and app permissions, then try again.'},
      ja: {checking:'📍 現在地を確認中です。許可を求められたら位置情報を許可してください。',success:'📍 現在地を地図に表示しました。',unsupported:'この環境では位置情報を利用できません。',insecure:'位置情報にはHTTPS接続が必要です。',denied:'位置情報へのアクセスが拒否されました。アプリまたはブラウザーの許可を確認してください。',timeout:'位置情報の取得がタイムアウトしました。位置情報サービスを確認して再試行してください。',unavailable:'端末の位置情報サービスとアプリの許可を確認してください。'},
      'zh-CN': {checking:'📍 正在获取当前位置。如有提示，请允许位置访问。',success:'📍 已在地图上显示当前位置。',unsupported:'此环境不支持定位。',insecure:'定位功能需要安全的HTTPS连接。',denied:'位置权限被拒绝。请检查应用或浏览器的位置权限。',timeout:'获取位置超时。请开启设备定位后重试。',unavailable:'请检查设备定位服务和应用权限后重试。'}
    };
    // Show the GPS button's purpose even when the device denies location access.
    // The marker popup appears only after coordinates were obtained successfully.
    var myLocationNames = { ko: '내 위치', en: 'My Location', ja: '現在地', 'zh-CN': '我的位置' };
    function myLocationName() {
      return myLocationNames[currentLang] || myLocationNames.ko;
    }
    function updateMyLocationLabels() {
      var label = myLocationName();
      var button = document.getElementById('mapGeoButton');
      if (button) {
        button.classList.remove('rounded-full', 'p-3');
        button.classList.add('rounded-xl', 'px-3', 'py-2.5', 'gap-1.5');
        button.title = label;
        button.setAttribute('aria-label', label);
        var visibleLabel = document.getElementById('mapGeoButtonLabel');
        if (!visibleLabel) {
          visibleLabel = document.createElement('span');
          visibleLabel.id = 'mapGeoButtonLabel';
          visibleLabel.className = 'text-xs font-bold whitespace-nowrap';
          button.appendChild(visibleLabel);
        }
        visibleLabel.textContent = label;
      }
      if (myLocationMarker) myLocationMarker.setTitle(label);
      if (myLocationInfoWindow) {
        var infoContent = document.createElement('span');
        infoContent.textContent = '📍 ' + label;
        infoContent.style.fontWeight = '700';
        infoContent.style.fontSize = '13px';
        infoContent.style.whiteSpace = 'nowrap';
        myLocationInfoWindow.setContent(infoContent);
      }
    }
    function showMapLocationStatus(key) {
      var status = document.getElementById('mapGeoStatus');
      if (!status) return;
      var words = mapLocationTranslations[currentLang] || mapLocationTranslations.ko;
      status.textContent = words[key] || words.unavailable;
      status.classList.remove('hidden');
      status.dataset.geoState = key;
    }

    var roomUserCounts = {};
    var currentRoomUsersRef = null;
    var roomPresenceListener = null;
    var messageListenerRef = null;
    var roomAdmissionReady = false;
    var roomConnectionRef = null;
    var roomConnectionCallback = null;
    var roomReconnectBusy = false;
    // Serialize an explicit exit before allowing another admission for the same UID.
    var roomLeaveInFlight = Promise.resolve();

    // v17: restore from the same Firebase anonymous UID; browser cache is a fallback.
    var profileRestoreStarted = false;
    function restoreProfileAfterAuth() {
      if (profileRestoreStarted || !myUserId) return;
      profileRestoreStarted = true;
      db.ref('userProfiles/' + myUserId).once('value').then(function(snapshot) {
        var p = snapshot.val();
        if (p && typeof p === 'object' && typeof p.nickname === 'string' && p.nickname.trim() && typeof p.country === 'string' && p.country) {
          userCountry = p.country;
          userNickname = p.nickname;
          if (['ko','en','ja','zh-CN'].includes(p.language)) currentLang = p.language;
          if (typeof p.autoTranslate === 'boolean') autoTranslateEnabled = p.autoTranslate;
          localStorage.setItem('my_user_country', userCountry);
          localStorage.setItem('my_user_nickname', userNickname);
          localStorage.setItem('localtalk_ui_lang', currentLang);
          localStorage.setItem('localtalk_auto_translate', autoTranslateEnabled ? 'on' : 'off');
          changeLanguage(currentLang);
        } else if (userCountry && userNickname) {
          persistProfileV17(); // migrate existing v16 browser profile once.
        }
        checkUserProfile();
      }).catch(function(err) {
        console.warn('Profile restore unavailable, using browser profile:', err);
        checkUserProfile();
      });
    }
    function persistProfileV17() {
      if (!authReady || !myUserId || !userCountry || !userNickname) return Promise.resolve();
      return db.ref('userProfiles/' + myUserId).set({
        nickname:userNickname, country:userCountry, language:currentLang,
        autoTranslate:autoTranslateEnabled, updatedAt:firebase.database.ServerValue.TIMESTAMP
      }).catch(function(err) { console.warn('Profile cloud save failed; browser copy retained:',err); });
    }
    function checkUserProfile() {
      if (!userCountry || !userNickname) openProfileModal();
      else { updateHeaderUserLabel(); document.getElementById('profileModal').classList.add('hidden'); }
    }

    function openProfileModal() {
      if (userCountry) document.getElementById('modalCountry').value = userCountry;
      if (userNickname) document.getElementById('modalNickname').value = userNickname;
      document.getElementById('profileLanguage').value = currentLang;
      document.getElementById('profileAutoTranslate').checked = autoTranslateEnabled;
      updateStaticUiV10();
      updateProfileLabelsV12();
      updateCountryOptionsV13();
      updateProfileSaveLabelV13();
      refreshBlockedManagerLabels();
      refreshAccountDeleteLabel();
      document.getElementById('profileCancelButton').classList.toggle('hidden', !userCountry || !userNickname);
      loadSafetyBlocked();
      document.getElementById('manageBlockedLabel').textContent=blockedManagerText().title;
      document.getElementById('profileModal').classList.remove('hidden');
      refreshOfficialAdmin();
    }

    function closeProfileModal() {
      if (!userCountry || !userNickname) return;
      document.getElementById('profileModal').classList.add('hidden');
    }

    function saveUserProfile() {
      var country = document.getElementById('modalCountry').value;
      var nick = document.getElementById('modalNickname').value.trim();

      if (!nick) {
        alert(uiText('nickRequired'));
        return;
      }

      if (nick.length > 30) { alert(uiText('nickTooLong')); return; }
      var selectedLanguage = document.getElementById('profileLanguage').value;
      var selectedAutoTranslate = document.getElementById('profileAutoTranslate').checked;
      userCountry = country;
      userNickname = nick;
      autoTranslateEnabled = selectedAutoTranslate;
      localStorage.setItem('localtalk_auto_translate', selectedAutoTranslate ? 'on' : 'off');

      localStorage.setItem('my_user_country', userCountry);
      localStorage.setItem('my_user_nickname', userNickname);

      document.getElementById('profileModal').classList.add('hidden');
      updateHeaderUserLabel();
      changeLanguage(selectedLanguage);
      persistProfileV17();
      if (currentRoomUsersRef && authReady) {
        // Preserve original joinedAt so a profile edit does not look like a new entry.
        currentRoomUsersRef.child('name').set(getFormattedMySender()).catch(function(error) {
          console.error('Profile sync failed:', error);
          alert(uiText('profileSyncFailed'));
        });
      }
    }

    // v20.33 TEST ONLY: self-service deletion for anonymous traveler identities.
    // Reports/moderation audit records and room messages are NOT removed here.
    var accountDeletionBusy = false;
    function accountDeletionLabels() {
      return {
        ko:['내 데이터 및 익명 계정 삭제','현재 익명 계정의 프로필, 작성 게시글·댓글과 Firebase 인증 계정을 삭제합니다. 되돌릴 수 없습니다. 신고·관리 기록 및 대화방에 남아 있는 메시지는 이 기능으로 삭제되지 않습니다. 계속할까요?','삭제하려면 DELETE를 입력하세요.','삭제가 완료되었습니다. 새 사용자로 시작합니다.','삭제 중 오류가 발생했습니다. 일부 게시글이나 댓글은 이미 삭제되었을 수 있습니다. 계정은 유지되므로 다시 시도하거나 지원팀에 문의하세요.','익명 여행자 계정에서만 사용할 수 있습니다. 관리자 Google 계정은 이 버튼으로 삭제할 수 없습니다.'],
        en:['Delete my data and anonymous account','Delete your profile, authored posts/comments and Firebase anonymous account permanently? Reports, moderation records and existing room messages are not deleted by this feature.','Type DELETE to confirm.','Deletion completed. Starting with a new user.','Deletion failed. Some posts/comments may already be removed. Your account remains; retry or contact support.','Only anonymous traveler accounts can use this action. Google admin accounts cannot be deleted here.'],
        ja:['自分のデータと匿名アカウントを削除','プロフィール、投稿・コメント、Firebase匿名アカウントを削除します。元に戻せません。通報・管理記録や残存するチャットメッセージは削除されません。','確認のため DELETE と入力してください。','削除が完了しました。','削除に失敗しました。一部のデータは削除済みの場合があります。再試行またはサポートに連絡してください。','匿名ユーザー専用です。Google管理者アカウントは削除できません。'],
        'zh-CN':['删除我的数据和匿名账户','永久删除个人资料、发布的帖子和评论及 Firebase 匿名账户。举报、管理记录及现存聊天消息不会被此功能删除。','请输入 DELETE 确认。','删除完成，将作为新用户开始。','删除失败。部分内容可能已删除。请重试或联系支持。','仅限匿名游客账户，不能删除 Google 管理员账户。']
      }[currentLang] || accountDeletionLabelsFallback();
    }
    function accountDeletionLabelsFallback(){return ['내 데이터 및 익명 계정 삭제','삭제할까요?','DELETE 입력','완료','오류','익명 계정 전용'];}
    function refreshAccountDeleteLabel(){
      var button=document.getElementById('deleteMyAccountButton');
      if(button)button.textContent=accountDeletionLabels()[0];
    }
    function deleteMyAccountV2033(){
      if(accountDeletionBusy || !requireAuth())return;
      var user=auth.currentUser, uid=user.uid, labels=accountDeletionLabels();
      if(!user.isAnonymous){alert(labels[5]);return;}
      if(!confirm(labels[1]))return;
      if(prompt(labels[2])!=='DELETE')return;
      accountDeletionBusy=true;
      var button=document.getElementById('deleteMyAccountButton');
      if(button){button.disabled=true;button.textContent='...';}
      // Read every city before deleting anything, so a permission/read failure cannot
      // silently leave unknown city posts behind after Auth identity deletion.
      var cityIds=Array.from(new Set(CITIES.concat(LEGACY_CITIES).map(function(c){return c.id;})));
      Promise.all(cityIds.map(function(cityId){
        return db.ref('communityPosts/'+cityId).once('value').then(function(snapshot){
          return {cityId:cityId,posts:snapshot.val()||{}};
        });
      })).then(function(cityData){
        var paths=[];
        cityData.forEach(function(group){
          Object.keys(group.posts).forEach(function(postId){
            var post=group.posts[postId];
            if(!post||typeof post!=='object')return;
            var base='communityPosts/'+group.cityId+'/'+postId;
            if(post.uid===uid){paths.push(base);return;}
            Object.keys(post.comments||{}).forEach(function(commentId){
              if(post.comments[commentId]&&post.comments[commentId].uid===uid)paths.push(base+'/comments/'+commentId);
            });
          });
        });
        // Existing Firebase rules allow deleting own posts/comments, not other users'.
        return paths.reduce(function(p,path){return p.then(function(){return db.ref(path).remove();});},Promise.resolve());
      }).then(function(){
        stopRoomListeners();
        return leaveCurrentRoom();
      }).then(function(){
        if(cityPresenceRef)return cityPresenceRef.remove();
      }).then(function(){
        return db.ref('userProfiles/'+uid).remove();
      }).then(function(){
        return user.delete();
      }).then(function(){
        ['my_user_country','my_user_nickname','localtalk_ui_lang','localtalk_auto_translate',
          'localtalk_blocked_'+uid,'localtalk_blocked_names_'+uid].forEach(function(key){localStorage.removeItem(key);});
        // Remove any per-user blocked lists under this application's prefix.
        Object.keys(localStorage).forEach(function(key){
          if(key.indexOf(uid)!==-1 && (key.indexOf('block')!==-1 || key.indexOf('safety')!==-1))localStorage.removeItem(key);
        });
        alert(labels[3]);
        window.location.reload();
      }).catch(function(error){
        console.error('Account deletion failed:',error);
        alert(labels[4]+' ('+(error.code||error.message||'unknown')+')');
      }).finally(function(){accountDeletionBusy=false;if(button){button.disabled=false;refreshAccountDeleteLabel();}});
    }

    function updateHeaderUserLabel() {
      var flagOnly = userCountry ? userCountry.split(' ')[0] : '🌐';
      document.getElementById('headerUserLabel').innerText = userNickname;
    }

    function getFormattedMySender() {
      var flagOnly = userCountry ? userCountry.split(' ')[0] : '🌐';
      return flagOnly + ' ' + userNickname;
    }

    var I18N = {
      ko: {
        appSub: '실시간 현지인 Q&A',
        searchPlaceholder: '도시·지역 검색 (예: 서울)',
        popularTitle: '주요 도시 및 지역 목록',
        online: '명 접속 중',
        enterBoard: '지역 게시판 입장',
        noticeSub: '여행 중 궁금한 점을 물어보세요! 현지 주민들이 답해드립니다.',
        inputPlaceholder: '질문이나 답변을 입력하세요...',
        noMsg: '아직 등록된 메시지가 없습니다. 첫 질문을 남겨보세요!',
        mySender: '나 (User)',
        boardTitleSuffix: ' 게시판',
        boardSub: '지역 정보 & 실시간 Q&A',
        chatSuffix: ' 실시간 톡',
        boardBannerSuffix: ' 실시간 대화방 목록',
        boardBannerSub: '원하는 채팅방을 선택하여 소통해보세요',
        boardPostsTitle: '<i class="fas fa-bullhorn text-amber-500"></i> 필독 정보 & 지역 꿀팁',
        send: '전송',
        roomListTitle: ' 실시간 대화방 선택',
        roomFull: '정원 초과',
        roomEnter: '입장하기',
        roomNoticeTitle: '실시간 Q&A 대화방 선택',
        roomNoticeSub: '쾌적한 대화를 위해 각 방당 최대 4명까지 입장 가능합니다.',
        mapTitle: '지역지도 (Google Maps)',
        mapSub: '글로벌 다국어 지명 및 실시간 장소/길찾기',
        mapQaLink: '[실시간 Q&A 보러가기]'
      },
      en: {
        appSub: 'Korea Real-time Local Q&A',
        searchPlaceholder: 'Search city or region (e.g. Seoul, Daegu, Yeosu)',
        popularTitle: 'Popular Cities & Regions',
        online: 'online',
        enterBoard: 'View Board',
        noticeSub: 'Ask local residents anything about your trip!',
        inputPlaceholder: 'Ask a question or share local tips...',
        noMsg: 'No messages yet. Be the first to ask!',
        mySender: 'Me (User)',
        boardTitleSuffix: ' Board',
        boardSub: 'Local Info & Real-time Q&A',
        chatSuffix: ' Live Chat',
        boardBannerSuffix: ' Chat Room List',
        boardBannerSub: 'Choose a room to start talking',
        boardPostsTitle: '<i class="fas fa-bullhorn text-amber-500"></i> Essential Info & Tips',
        send: 'Send',
        roomListTitle: ' Select Live Chat Room',
        roomFull: 'Full',
        roomEnter: 'Enter',
        roomNoticeTitle: 'Select Live Chat Room',
        roomNoticeSub: 'Max 4 people allowed per room for comfortable chatting.',
        mapTitle: 'Regional Map (Google Maps)',
        mapSub: 'Multilingual city names & live route directions',
        mapQaLink: '[Go to Live Q&A]'
      },
      ja: {
        appSub: '韓国 リアルタイム現地人 Q&A',
        searchPlaceholder: '都市/地域を検索 (例: ソウル, 大邱, 麗水)',
        popularTitle: '主要都市 & 地域一覧',
        online: '人オンライン',
        enterBoard: '掲示板を見る',
        noticeSub: '旅行中の疑問を現地の人に質問してみましょう！',
        inputPlaceholder: '質問や回答を入力してください...',
        noMsg: 'メッセージはまだありません。最初の質問を残してみましょう！',
        mySender: '私 (User)',
        boardTitleSuffix: ' 掲示板',
        boardSub: '地域情報 & リアルタイム Q&A',
        chatSuffix: ' リアルタイムトーク',
        boardBannerSuffix: ' リアルタイムチャット一覧',
        boardBannerSub: 'お好きな部屋を選んで会話を始めましょう',
        boardPostsTitle: '<i class="fas fa-bullhorn text-amber-500"></i> 必読情報 & 地元のコツ',
        send: '送信',
        roomListTitle: ' チャットルーム選択',
        roomFull: '満員',
        roomEnter: '入室する',
        roomNoticeTitle: 'リアルタイムチャットルーム選択',
        roomNoticeSub: '快適な会話のため、各部屋最大4名まで入室可能です。',
        mapTitle: '地域地図 (Google Maps)',
        mapSub: '多言語地名表示およびリアルタイムルート検索',
        mapQaLink: '[リアルタイム Q&Aへ]'
      },
      'zh-CN': {
        appSub: '韩国 实时当地人 Q&A',
        searchPlaceholder: '搜索城市或区域 (例如: 首尔, 大邱, 丽水)',
        popularTitle: '主要城市及区域列表',
        online: '人在线',
        enterBoard: '进入论坛',
        noticeSub: '提出您在旅行中的疑问！当地人为您解答。',
        inputPlaceholder: '请输入问题或回答...',
        noMsg: '暂无消息，快来发布第一个问题吧！',
        mySender: '我 (User)',
        boardTitleSuffix: ' 论坛',
        boardSub: '本地资讯 & 实时 Q&A',
        chatSuffix: ' 实时聊天',
        boardBannerSuffix: ' 实时聊天室列表',
        boardBannerSub: '选择您想加入的聊天室',
        boardPostsTitle: '<i class="fas fa-bullhorn text-amber-500"></i> 必读资讯 & 本地攻略',
        send: '发送',
        roomListTitle: ' 选择实时聊天室',
        roomFull: '已满',
        roomEnter: '进入',
        roomNoticeTitle: '选择实时聊天室',
        roomNoticeSub: '为了保持良好的沟通体验，每个聊天室限额4人。',
        mapTitle: '区域地图 (Google Maps)',
        mapSub: '多语言地名显示及实时路线规划',
        mapQaLink: '[前往实时 Q&A]'
      }
    };

    // v9: localized static interface copy. Translation of user chat messages is separate.
    var UI_V9 = {
      ko: {enterShort:'입장', home:'홈', map:'지역지도', my:'마이', place:'📍 장소', placeTitle:'📍 채팅방에 장소 공유', placeSearch:'장소 이름 또는 주소 검색', search:'검색', placeHelp:'장소를 검색하거나 지도에서 위치를 누르세요.', placeEmpty:'아직 장소를 선택하지 않았습니다.', placeShare:'이 장소를 채팅방에 공유', translateAuto:'받은 메시지 자동 번역 (한국어)', selected:'선택한 장소: ', walking:'🚶 Google 도보 길찾기 ↗', driving:'🚗 Google 자동차 길찾기 ↗', naver:'🧭 네이버 지도에서 장소 찾기 ↗', mapTip:'한국에서 Google 경로가 없으면 네이버 지도에서 길찾기를 선택하세요.', translate:'[번역하기]', translating:'번역 중…', retry:'다시 시도', again:'다시 번역', failed:'번역할 수 없습니다. 원문을 확인해 주세요.'},
      en: {enterShort:'Enter', home:'Home', map:'Map', my:'My', place:'📍 Place', placeTitle:'📍 Share a place in chat', placeSearch:'Search place or address', search:'Search', placeHelp:'Search for a place or tap the map.', placeEmpty:'No place selected yet.', placeShare:'Share this place in chat', translateAuto:'Auto-translate received messages (English)', selected:'Selected place: ', walking:'🚶 Google walking directions ↗', driving:'🚗 Google driving directions ↗', naver:'🧭 Find on Naver Map ↗', mapTip:'In Korea, if Google has no route, open Naver Map and choose Directions.', translate:'[Translate]', translating:'Translating…', retry:'Retry translation', again:'Translate again', failed:'Translation unavailable. Original shown above.'},
      ja: {enterShort:'入場', home:'ホーム', map:'地図', my:'マイ', place:'📍 場所', placeTitle:'📍 チャットに場所を共有', placeSearch:'場所名または住所を検索', search:'検索', placeHelp:'場所を検索するか地図をタップしてください。', placeEmpty:'場所が未選択です。', placeShare:'この場所を共有', translateAuto:'受信メッセージを自動翻訳（日本語）', selected:'選択した場所：', walking:'🚶 Google 徒歩ルート ↗', driving:'🚗 Google 車ルート ↗', naver:'🧭 NAVER地図で探す ↗', mapTip:'韓国でGoogleの経路が表示されない場合はNAVER地図でルート検索してください。', translate:'[翻訳]', translating:'翻訳中…', retry:'再試行', again:'再翻訳', failed:'翻訳できません。原文をご確認ください。'},
      'zh-CN': {enterShort:'进入', home:'首页', map:'地图', my:'我的', place:'📍 地点', placeTitle:'📍 在聊天室分享地点', placeSearch:'搜索地点名称或地址', search:'搜索', placeHelp:'搜索地点或点击地图。', placeEmpty:'尚未选择地点。', placeShare:'分享到聊天室', translateAuto:'自动翻译收到的消息（中文）', selected:'已选地点：', walking:'🚶 Google 步行路线 ↗', driving:'🚗 Google 驾车路线 ↗', naver:'🧭 在NAVER地图查找 ↗', mapTip:'在韩国若Google无路线，请在NAVER地图中选择路线导航。', translate:'[翻译]', translating:'翻译中…', retry:'重试', again:'重新翻译', failed:'翻译不可用，请查看原文。'}
    };
    Object.keys(UI_V9).forEach(function(lang) { Object.assign(I18N[lang], UI_V9[lang]); });
    function updateStaticUiV9() {
      var t = I18N[currentLang] || I18N.ko;
      var items = [
        ['#tabHome span',t.home], ['#tabMap span',t.map], ['#tabMy span',t.my],
        ['#placePicker strong',t.placeTitle], ['#placePicker .p-3.border-t button',t.placeShare]
      ];
      items.forEach(function(item) { var el=document.querySelector(item[0]); if(el) el.textContent=item[1]; });
      var placeBtn=document.getElementById('sharePlaceButton');if(placeBtn) placeBtn.textContent=t.place;
      var searchBtn=document.getElementById('placeSearchButton');if(searchBtn) searchBtn.textContent=t.search;
      var placeInput=document.getElementById('placeSearchInput');if(placeInput) placeInput.placeholder=t.placeSearch;
      var help=document.getElementById('placeHelp');if(help) help.textContent=t.placeHelp;
      var selected=document.getElementById('selectedPlaceLabel');if(selected) selected.textContent=selectedSharePlace?t.selected+selectedSharePlace.name:t.placeEmpty;
      var auto=document.getElementById('autoTranslationLabel');if(auto) auto.textContent=t.translateAuto;
      document.documentElement.lang=currentLang === 'zh-CN' ? 'zh-CN' : currentLang;
    }
    // v10: consistent UI translations for profile, notices, dialogs and status.
    var UI_V10 = {
      ko: {profileTitle:'프로필 설정',profileDescription:'대화방에서 사용할 국가와 별명을 선택해주세요.',profileCountry:'국가 선택',profileNickname:'별명 (닉네임)',profileNicknamePlaceholder:'예: 대구여행자, 로컬맛집탐험가',profileSave:'시작하기',boardMax:'LIVE Q&A (최대 4명)',roomMax:'최대 4명 정원 대화방',roomOccupancy:'명 참여 중',roomFullShort:'꽉참',roomFullAlert:'정원이 가득 찬 채팅방입니다.',roomJoinFailed:'채팅방 입장에 실패했습니다. 잠시 후 다시 시도해 주세요.',joined:'님이 입장했습니다.',left:'님이 퇴장했습니다.',participant:'참여자',nowOnline:'👥 현재 {n}명 참여 중',mine:'나',leaveConfirm:'채팅방을 나가시겠습니까?\n마지막 사람이 나가면 대화 기록 삭제를 시도합니다.',placeRequiresRoom:'채팅방에 입장한 뒤 장소를 공유할 수 있습니다.',placeNotFound:'장소를 찾지 못했습니다. 다른 이름이나 주소로 검색해 주세요.',placeTooLong:'장소 정보가 너무 깁니다.',sendNotReady:'채팅방 입장 처리 중입니다. 잠시 후 다시 보내주세요.',messageTooLong:'메시지는 2,000자 이하로 입력해 주세요.',sendFailed:'메시지 전송에 실패했습니다. 다시 시도해 주세요.',nickRequired:'별명을 입력해 주세요!',authWait:'연결 중입니다. 잠시 후 다시 시도해 주세요.',authConnecting:'안전한 연결을 준비하고 있습니다...',authFailed:'로그인 연결에 실패했습니다. 인터넷 연결과 Firebase 설정을 확인해 주세요.',authStateFailed:'인증 상태를 확인할 수 없습니다. 다시 시도해 주세요.',authRetry:'다시 시도',postViews:'조회 {n} (클릭하여 보기)',today:'오늘',localResident:'현지인',seoulResident:'서울시민',mapSearchPlaceholder:'장소(예: 현대, 더현대 대구)',mapNoPlace:'장소를 찾을 수 없습니다. (예: 더현대 대구, 반월당역)',geoFailed:'위치 정보를 가져올 수 없습니다. 브라우저 위치 접근을 허용해 주세요.',naverDirections:uiText('naverDirections'),kakaoDirections:uiText('kakaoDirections'),close:'닫기'},
      en: {profileTitle:'Set up your profile',profileDescription:'Choose your country and nickname for chat.',profileCountry:'Country',profileNickname:'Nickname',profileNicknamePlaceholder:'e.g. DaeguTraveler',profileSave:'Get started',boardMax:'LIVE Q&A (Max 4)',roomMax:'Chat rooms · Max 4 people',roomOccupancy:' people in room',roomFullShort:'Full',roomFullAlert:'This chat room is full.',roomJoinFailed:'Could not join the room. Please try again.',joined:' joined the room.',left:' left the room.',participant:'Guest',nowOnline:'👥 {n} people in room',mine:'Me',leaveConfirm:'Leave this chat room?\nWhen everyone leaves, the chat history will be cleared where possible.',placeRequiresRoom:'Join a chat room before sharing a place.',placeNotFound:'Place not found. Try another name or address.',placeTooLong:'Place information is too long.',sendNotReady:'Joining the room. Please wait a moment.',messageTooLong:'Messages must be 2,000 characters or fewer.',sendFailed:'Could not send the message. Please try again.',nickRequired:'Please enter a nickname.',authWait:'Connecting. Please try again shortly.',authConnecting:'Establishing a secure connection…',authFailed:'Sign-in failed. Check your internet and Firebase settings.',authStateFailed:'Could not verify sign-in. Please try again.',authRetry:'Retry',postViews:'{n} views · Tap to read',today:'Today',localResident:'Local resident',seoulResident:'Seoul resident',mapSearchPlaceholder:'Search a place (e.g. The Hyundai Daegu)',mapNoPlace:'Place not found. Try another search.',geoFailed:'Location unavailable. Please allow location access.',naverDirections:'🧭 Directions in Naver Map',kakaoDirections:'💛 Directions in Kakao Map',close:'Close'},
      ja: {profileTitle:'プロフィール設定',profileDescription:'チャットで使う国とニックネームを選択してください。',profileCountry:'国を選択',profileNickname:'ニックネーム',profileNicknamePlaceholder:'例：大邱旅行者',profileSave:'始める',boardMax:'LIVE Q&A（最大4人）',roomMax:'チャットルーム（最大4人）',roomOccupancy:'人参加中',roomFullShort:'満員',roomFullAlert:'このチャットルームは満員です。',roomJoinFailed:'入室できませんでした。もう一度お試しください。',joined:'さんが入室しました。',left:'さんが退室しました。',participant:'参加者',nowOnline:'👥 現在{n}人参加中',mine:'自分',leaveConfirm:'チャットルームを退出しますか？\n全員が退出すると履歴の削除を試みます。',placeRequiresRoom:'入室してから場所を共有してください。',placeNotFound:'場所が見つかりません。別の名前や住所をお試しください。',placeTooLong:'場所の情報が長すぎます。',sendNotReady:'入室処理中です。少々お待ちください。',messageTooLong:'メッセージは2,000文字以内にしてください。',sendFailed:'送信できませんでした。再試行してください。',nickRequired:'ニックネームを入力してください。',authWait:'接続中です。少々お待ちください。',authConnecting:'安全に接続しています…',authFailed:'ログインに失敗しました。ネット接続とFirebaseの設定をご確認ください。',authStateFailed:'認証状態を確認できません。再試行してください。',authRetry:'再試行',postViews:'閲覧 {n} · タップして読む',today:'今日',localResident:'地元の人',seoulResident:'ソウル市民',mapSearchPlaceholder:'場所を検索（例：ザ・現代 大邱）',mapNoPlace:'場所が見つかりません。別の検索語をお試しください。',geoFailed:'位置情報を取得できません。位置情報へのアクセスを許可してください。',naverDirections:'🧭 NAVER地図でルート検索',kakaoDirections:'💛 KakaoMapでルート検索',close:'閉じる'},
      'zh-CN': {profileTitle:'设置个人资料',profileDescription:'请选择聊天室中使用的国家和昵称。',profileCountry:'选择国家',profileNickname:'昵称',profileNicknamePlaceholder:'例如：大邱旅行者',profileSave:'开始使用',boardMax:'实时问答（最多4人）',roomMax:'聊天室（最多4人）',roomOccupancy:'人参与',roomFullShort:'已满',roomFullAlert:'该聊天室已满。',roomJoinFailed:'进入聊天室失败，请稍后重试。',joined:'加入了聊天室。',left:'离开了聊天室。',participant:'参与者',nowOnline:'👥 当前{n}人参与',mine:'我',leaveConfirm:'确定离开聊天室吗？\n所有人离开后将尝试清除聊天记录。',placeRequiresRoom:'请先进入聊天室再分享地点。',placeNotFound:'未找到地点，请尝试其他名称或地址。',placeTooLong:'地点信息过长。',sendNotReady:'正在进入聊天室，请稍候。',messageTooLong:'消息不能超过2,000个字符。',sendFailed:'消息发送失败，请重试。',nickRequired:'请输入昵称。',authWait:'正在连接，请稍后重试。',authConnecting:'正在建立安全连接…',authFailed:'登录失败，请检查网络及Firebase设置。',authStateFailed:'无法验证登录状态，请重试。',authRetry:'重试',postViews:'浏览 {n} · 点击查看',today:'今天',localResident:'当地居民',seoulResident:'首尔居民',mapSearchPlaceholder:'搜索地点（例如：现代百货大邱店）',mapNoPlace:'未找到地点，请更换关键词。',geoFailed:'无法获取位置，请允许浏览器访问位置。',naverDirections:'🧭 在NAVER地图中导航',kakaoDirections:'💛 在Kakao地图中导航',close:'关闭'}
    };
    Object.keys(UI_V10).forEach(function(lang) { Object.assign(I18N[lang], UI_V10[lang]); });
    function uiText(key, n) {
      var value = (I18N[currentLang] || I18N.ko)[key] || I18N.ko[key] || key;
      return n === undefined ? value : value.replace('{n}', String(n));
    }
    // v12: My/profile settings, localized for all supported interface languages.
    var PROFILE_V12 = {
      ko:{profileLanguage:'앱 표시 언어',profileAuto:'받은 메시지 자동 번역',profilePrivacy:'닉네임·국가·언어 설정은 이 브라우저에 저장됩니다. 채팅 중 닉네임을 바꾸면 참여자 목록에도 반영됩니다.',profileCancel:'닫기',profileSave:'변경사항 저장',nickTooLong:'닉네임은 30자 이하로 입력해 주세요.',profileSyncFailed:'프로필은 저장됐지만 채팅방에 반영하지 못했습니다. 다시 입장해 주세요.'},
      en:{profileLanguage:'App language',profileAuto:'Auto-translate received messages',profilePrivacy:'Nickname, country and language settings are saved in this browser. Nickname changes also update your room presence.',profileCancel:'Close',profileSave:'Save changes',nickTooLong:'Nickname must be 30 characters or fewer.',profileSyncFailed:'Profile saved, but room update failed. Please rejoin.'},
      ja:{profileLanguage:'アプリの表示言語',profileAuto:'受信メッセージを自動翻訳',profilePrivacy:'ニックネーム・国・言語設定はこのブラウザーに保存されます。変更した名前は参加者一覧にも反映されます。',profileCancel:'閉じる',profileSave:'変更を保存',nickTooLong:'ニックネームは30文字以内で入力してください。',profileSyncFailed:'保存されましたが、チャットへの反映に失敗しました。再入室してください。'},
      'zh-CN':{profileLanguage:'应用显示语言',profileAuto:'自动翻译收到的消息',profilePrivacy:'昵称、国家和语言设置保存在本浏览器中。修改昵称后，聊天室成员列表也会更新。',profileCancel:'关闭',profileSave:'保存更改',nickTooLong:'昵称不能超过30个字符。',profileSyncFailed:'资料已保存，但聊天室更新失败。请重新进入。'}
    };
    Object.keys(PROFILE_V12).forEach(function(lang) { Object.assign(I18N[lang], PROFILE_V12[lang]); });
    // v13: country labels are presentation-only; saved country values stay unchanged.
    var COUNTRY_LABELS_V13 = {
      ko:['대한민국','미국','일본','중국','대만','베트남','태국','영국','프랑스','독일','기타'],
      en:['South Korea','United States','Japan','China','Taiwan','Vietnam','Thailand','United Kingdom','France','Germany','Other'],
      ja:['韓国','アメリカ','日本','中国','台湾','ベトナム','タイ','イギリス','フランス','ドイツ','その他'],
      'zh-CN':['韩国','美国','日本','中国','台湾','越南','泰国','英国','法国','德国','其他']
    };
    function updateCountryOptionsV13() {
      var select=document.getElementById('modalCountry');
      if (!select) return;
      var names=COUNTRY_LABELS_V13[currentLang] || COUNTRY_LABELS_V13.ko;
      Array.from(select.options).forEach(function(option, i) {
        var flag=option.value.split(' ')[0];
        option.textContent=flag+' '+(names[i] || option.value);
      });
    }
    function updateProfileLabelsV12() {
      var mapping={profileLanguageLabel:'profileLanguage',profileAutoTranslateLabel:'profileAuto',profilePrivacyNote:'profilePrivacy',profileCancelButton:'profileCancel'};
      Object.keys(mapping).forEach(function(id) {
        var el=document.getElementById(id); if(el) el.textContent=uiText(mapping[id]);
      });
    }
    function updateProfileSaveLabelV13() {
      var button=document.getElementById('profileSaveButton');
      if (!button) return;
      button.textContent = (userCountry && userNickname) ? uiText('profileSaveChangesV13') : uiText('profileStartV13');
    }
    var PROFILE_BUTTON_V13={
      ko:{profileStartV13:'시작하기',profileSaveChangesV13:'변경사항 저장'},
      en:{profileStartV13:'Get started',profileSaveChangesV13:'Save changes'},
      ja:{profileStartV13:'始める',profileSaveChangesV13:'変更を保存'},
      'zh-CN':{profileStartV13:'开始使用',profileSaveChangesV13:'保存更改'}
    };
    Object.keys(PROFILE_BUTTON_V13).forEach(function(lang){Object.assign(I18N[lang],PROFILE_BUTTON_V13[lang]);});
    function updateStaticUiV10() {
      var labels = {profileTitle:'profileTitle',profileDescription:'profileDescription',profileCountryLabel:'profileCountry',profileNicknameLabel:'profileNickname',profileSaveButton:'profileSave',boardMaxBadge:'boardMax',authRetry:'authRetry'};
      Object.keys(labels).forEach(function(id) { var el=document.getElementById(id); if(el) el.textContent=uiText(labels[id]); });
      var nick=document.getElementById('modalNickname'); if(nick) nick.placeholder=uiText('profileNicknamePlaceholder');
      var mapInput=document.getElementById('mapSearchInput'); if(mapInput) mapInput.placeholder=uiText('mapSearchPlaceholder');
      var close=document.getElementById('closePlacePickerButton'); if(close) close.setAttribute('aria-label',uiText('close'));
      var cityRoomNotice=document.getElementById('roomListNoticeSub'); if(cityRoomNotice) cityRoomNotice.textContent=I18N[currentLang].roomNoticeSub;
    }

    // 요청하신 9개 지역 구조 (서울, 제주, 부산, 경기, 강원, 경북, 경남, 전북, 전남)
    var CITIES = [
      {id:'seoul',name:{ko:'서울',en:'Seoul',ja:'ソウル','zh-CN':'首尔'},desc:{ko:'여행 정보 · 현지인 채팅',en:'Travel tips · Local chat',ja:'旅行情報・現地チャット','zh-CN':'旅行信息 · 当地聊天'},subCities:{ko:'홍대 · 명동 · 경복궁',en:'Hongdae · Myeongdong · Gyeongbokgung',ja:'弘大 · 明洞 · 景福宮','zh-CN':'弘大 · 明洞 · 景福宫'},lat:37.5665,lng:126.978,photo:'city-photos/seoul.jpg?v=2020'},
      {id:'busan',name:{ko:'부산',en:'Busan',ja:'釜山','zh-CN':'釜山'},desc:{ko:'여행 정보 · 현지인 채팅',en:'Travel tips · Local chat',ja:'旅行情報・現地チャット','zh-CN':'旅行信息 · 当地聊天'},subCities:{ko:'해운대 · 광안리 · 감천문화마을',en:'Haeundae · Gwangalli · Gamcheon',ja:'海雲台 · 広安里 · 甘川','zh-CN':'海云台 · 广安里 · 甘川'},lat:35.1796,lng:129.0756,photo:'city-photos/busan.jpg?v=2017'},
      {id:'jeju',name:{ko:'제주',en:'Jeju',ja:'済州','zh-CN':'济州'},desc:{ko:'여행 정보 · 현지인 채팅',en:'Travel tips · Local chat',ja:'旅行情報・現地チャット','zh-CN':'旅行信息 · 当地聊天'},subCities:{ko:'성산일출봉 · 협재 · 돌하르방',en:'Seongsan · Hyeopjae · Dol Hareubang',ja:'城山日出峰 · 挟才 · トルハルバン','zh-CN':'城山日出峰 · 挟才 · 石爷爷'},lat:33.4996,lng:126.5312,photo:'city-photos/jeju.jpg?v=2017'},
      {id:'gyeongju',name:{ko:'경주',en:'Gyeongju',ja:'慶州','zh-CN':'庆州'},desc:{ko:'여행 정보 · 현지인 채팅',en:'Travel tips · Local chat',ja:'旅行情報・現地チャット','zh-CN':'旅行信息 · 当地聊天'},subCities:{ko:'불국사 · 황리단길 · 첨성대',en:'Bulguksa · Hwangnidan · Cheomseongdae',ja:'仏国寺 · 皇理団通り · 瞻星台','zh-CN':'佛国寺 · 皇理团路 · 瞻星台'},lat:35.8562,lng:129.2247,photo:'city-photos/gyeongju.jpg?v=2017'},
      {id:'incheon',name:{ko:'인천',en:'Incheon',ja:'仁川','zh-CN':'仁川'},desc:{ko:'여행 정보 · 현지인 채팅',en:'Travel tips · Local chat',ja:'旅行情報・現地チャット','zh-CN':'旅行信息 · 当地聊天'},subCities:{ko:'차이나타운 · 송도 · 월미도',en:'Chinatown · Songdo · Wolmido',ja:'チャイナタウン · 松島 · 月尾島','zh-CN':'唐人街 · 松岛 · 月尾岛'},lat:37.4563,lng:126.7052,photo:'city-photos/incheon.jpg?v=2020'},
      {id:'gangneung',name:{ko:'강릉',en:'Gangneung',ja:'江陵','zh-CN':'江陵'},desc:{ko:'여행 정보 · 현지인 채팅',en:'Travel tips · Local chat',ja:'旅行情報・現地チャット','zh-CN':'旅行信息 · 当地聊天'},subCities:{ko:'경포대 · 안목해변 · 정동진',en:'Gyeongpo · Anmok Beach · Jeongdongjin',ja:'鏡浦台 · 安木海岸 · 正東津','zh-CN':'镜浦台 · 安木海滩 · 正东津'},lat:37.7519,lng:128.8761,photo:'city-photos/gangneung.jpg?v=2017'},
      {id:'jeonju',name:{ko:'전주',en:'Jeonju',ja:'全州','zh-CN':'全州'},desc:{ko:'여행 정보 · 현지인 채팅',en:'Travel tips · Local chat',ja:'旅行情報・現地チャット','zh-CN':'旅行信息 · 当地聊天'},subCities:{ko:'한옥마을 · 경기전 · 남부시장',en:'Hanok Village · Gyeonggijeon · Market',ja:'韓屋村 · 慶基殿 · 南部市場','zh-CN':'韩屋村 · 庆基殿 · 南部市场'},lat:35.8242,lng:127.148,photo:'city-photos/jeonju.jpg?v=2017'},
      {id:'sokcho',name:{ko:'속초',en:'Sokcho',ja:'束草','zh-CN':'束草'},desc:{ko:'여행 정보 · 현지인 채팅',en:'Travel tips · Local chat',ja:'旅行情報・現地チャット','zh-CN':'旅行信息 · 当地聊天'},subCities:{ko:'설악산 · 속초해변 · 중앙시장',en:'Seoraksan · Sokcho Beach · Market',ja:'雪岳山 · 束草海岸 · 中央市場','zh-CN':'雪岳山 · 束草海滩 · 中央市场'},lat:38.207,lng:128.5918,photo:'city-photos/sokcho.jpg?v=2017'},
      {id:'yeosu',name:{ko:'여수',en:'Yeosu',ja:'麗水','zh-CN':'丽水'},desc:{ko:'여행 정보 · 현지인 채팅',en:'Travel tips · Local chat',ja:'旅行情報・現地チャット','zh-CN':'旅行信息 · 当地聊天'},subCities:{ko:'오동도 · 돌산대교 · 낭만포차',en:'Odongdo · Dolsan Bridge · Food Street',ja:'梧桐島 · 突山大橋 · 屋台街','zh-CN':'梧桐岛 · 突山大桥 · 浪漫排档'},lat:34.7604,lng:127.6622,photo:'city-photos/yeosu.jpg?v=2017'},
      {id:'daegu',name:{ko:'대구',en:'Daegu',ja:'大邱','zh-CN':'大邱'},desc:{ko:'여행 정보 · 현지인 채팅',en:'Travel tips · Local chat',ja:'旅行情報・現地チャット','zh-CN':'旅行信息 · 当地聊天'},subCities:{ko:'동성로 · 앞산 · 서문시장',en:'Dongseong-ro · Apsan · Seomun Market',ja:'東城路 · 前山 · 西門市場','zh-CN':'东城路 · 前山 · 西门市场'},lat:35.8714,lng:128.6014,photo:'city-photos/daegu.jpg?v=2017'},
      {id:'daejeon',name:{ko:'대전',en:'Daejeon',ja:'大田','zh-CN':'大田'},desc:{ko:'여행 정보 · 현지인 채팅',en:'Travel tips · Local chat',ja:'旅行情報・現地チャット','zh-CN':'旅行信息 · 当地聊天'},subCities:{ko:'성심당 · 엑스포 · 한밭수목원',en:'Sungsimdang · Expo · Hanbat Arboretum',ja:'聖心堂 · エキスポ · ハンバッ樹木園','zh-CN':'圣心堂 · 世博园 · 韩巴树木园'},lat:36.3504,lng:127.3845,photo:'city-photos/daejeon.jpg?v=2017'},
      {id:'gwangju',name:{ko:'광주',en:'Gwangju',ja:'光州','zh-CN':'光州'},desc:{ko:'여행 정보 · 현지인 채팅',en:'Travel tips · Local chat',ja:'旅行情報・現地チャット','zh-CN':'旅行信息 · 当地聊天'},subCities:{ko:'양림동 · 무등산 · 충장로',en:'Yangnim-dong · Mudeungsan · Chungjang-ro',ja:'楊林洞 · 無等山 · 忠壮路','zh-CN':'杨林洞 · 无等山 · 忠壮路'},lat:35.1595,lng:126.8526,photo:'city-photos/gwangju.jpg?v=2017'}
    ];
    var LEGACY_CITIES = [
      { 
        id: 'gyeonggi', 
        name: { ko: '경기', en: 'Gyeonggi Region', ja: '京畿地域', 'zh-CN': '京畿区域' },
        iconTag: '<div class="w-11 h-11 rounded-2xl bg-indigo-50 border-indigo-100 border flex items-center justify-center shadow-sm shrink-0 text-2xl" aria-hidden="true">🏰</div>', 
        desc: { ko: '수원화성, 파주 아울렛, 가평 남이섬', en: 'Suwon, Paju, Gapyeong & Yongin', ja: '水原、坡州、加平の質問', 'zh-CN': '水原、坡州、加平资讯' }, 
        subCities: { ko: '수원 · 성남 · 고양 · 용인 · 파주', en: 'Suwon · Seongnam · Goyang', ja: '水原・城南・高陽・龍仁', 'zh-CN': '水原・城南・高阳・龙仁' },
        lat: 37.2636, lng: 127.0286
      },
      { 
        id: 'gangwon', 
        name: { ko: '강원', en: 'Gangwon Region', ja: '江原地域', 'zh-CN': '江原区域' },
        iconTag: '<div class="w-11 h-11 rounded-2xl bg-teal-50 border-teal-100 border flex items-center justify-center shadow-sm shrink-0 text-2xl" aria-hidden="true">🏔️</div>', 
        desc: { ko: '속초 바다, 강릉 커피거리, 춘천 닭갈비', en: 'Sokcho, Gangneung & Chuncheon', ja: '束草、江陵、春川の質問', 'zh-CN': '束草、江陵、春川资讯' }, 
        subCities: { ko: '강릉 · 속초 · 춘천 · 평창', en: 'Gangneung · Sokcho · Chuncheon', ja: '江陵・束草・春川・平昌', 'zh-CN': '江陵・束草・春川・平昌' },
        lat: 37.8228, lng: 128.1555
      },
      { 
        id: 'gyeongbuk', 
        name: { ko: '경북', en: 'Gyeongbuk Region', ja: '慶北地域', 'zh-CN': '庆北区域' },
        iconTag: '<div class="w-11 h-11 rounded-2xl bg-purple-50 border-purple-100 border flex items-center justify-center shadow-sm shrink-0 text-2xl" aria-hidden="true">🏛️</div>', 
        desc: { ko: '대구 동성로, 경주 황리단길, 포항 영일대', en: 'Daegu, Gyeongju, Pohang & Andong', ja: '大邱、慶州、浦項、安東', 'zh-CN': '大邱、庆州、浦项、安东' }, 
        subCities: { ko: '대구 · 경주 · 포항 · 안동', en: 'Daegu · Gyeongju · Pohang', ja: '大邱・慶州・浦項・安東', 'zh-CN': '大邱・庆州・浦项・安东' },
        lat: 35.8714, lng: 128.6014
      },
      { 
        id: 'gyeongnam', 
        name: { ko: '경남', en: 'Gyeongnam Region', ja: '慶南地域', 'zh-CN': '庆南区域' },
        iconTag: '<div class="w-11 h-11 rounded-2xl bg-blue-50 border-blue-100 border flex items-center justify-center shadow-sm shrink-0 text-2xl" aria-hidden="true">⛵</div>', 
        desc: { ko: '울산 대왕암, 거제 바람의언덕, 통영 루지', en: 'Ulsan, Changwon, Geoje & Tongyeong', ja: '蔚山、昌原、巨済、統営', 'zh-CN': '蔚山、昌原、巨济、统营' }, 
        subCities: { ko: '울산 · 창원 · 거제 · 통영', en: 'Ulsan · Changwon · Geoje', ja: '蔚山・昌原・巨済・統営', 'zh-CN': '蔚山・昌原・巨济・统营' },
        lat: 35.2285, lng: 128.6811
      },
      { 
        id: 'jeonbuk', 
        name: { ko: '전북', en: 'Jeonbuk Region', ja: '全北地域', 'zh-CN': '全北区域' },
        iconTag: '<div class="w-11 h-11 rounded-2xl bg-amber-50 border-amber-100 border flex items-center justify-center shadow-sm shrink-0 text-2xl" aria-hidden="true">🏘️</div>', 
        desc: { ko: '전주 한옥마을, 군산 선유도, 익산', en: 'Jeonju, Gunsan & Iksan', ja: '全州、群山、益山', 'zh-CN': '全州、群山、益山' }, 
        subCities: { ko: '전주 · 군산 · 익산 · 남원', en: 'Jeonju · Gunsan · Iksan', ja: '全州・群山・益山・南原', 'zh-CN': '全州・群山・益山・南原' },
        lat: 35.8242, lng: 127.1480
      },
      { 
        id: 'jeonnam', 
        name: { ko: '전남', en: 'Jeonnam Region', ja: '全南地域', 'zh-CN': '全南区域' },
        iconTag: '<div class="w-11 h-11 rounded-2xl bg-emerald-50 border-emerald-100 border flex items-center justify-center shadow-sm shrink-0 text-2xl" aria-hidden="true">🌅</div>', 
        desc: { ko: '여수 밤바다, 순천만국가정원, 목포', en: 'Gwangju, Yeosu, Suncheon & Mokpo', ja: '光州、麗水、順天、木浦', 'zh-CN': '光州、丽水、顺天、木浦' }, 
        subCities: { ko: '광주 · 여수 · 순천 · 목포', en: 'Gwangju · Yeosu · Suncheon', ja: '光州・麗水・順天・木浦', 'zh-CN': '光州・丽水・顺天・木浦' },
        lat: 35.1595, lng: 126.8526
      }
    ];

    function loadGoogleMapsScript(langCode, callback) {
      var existingScript = document.getElementById("googleMapsScript");
      if (existingScript) {
        existingScript.remove();
      }
      delete window.google;

      var script = document.createElement("script");
      script.id = "googleMapsScript";
      script.src = "https://maps.googleapis.com/maps/api/js?key=" + googleApiKey + "&libraries=places&language=" + langCode;
      script.async = true;
      script.defer = true;
      script.onload = function() {
        if (callback) callback();
      };
      document.head.appendChild(script);
    }

    function getCityName(city) {
      if (!city) return '';
      return city.name[currentLang] || city.name['ko'];
    }

    function getCityDesc(city) {
      if (!city) return '';
      return city.desc[currentLang] || city.desc['ko'];
    }

    var lastCityCounts = {};
    function listenCityUsers() {
      if (!authReady || cityPresenceListenerRef) return;
      var presenceRef = db.ref('presence');
      cityPresenceListenerRef = presenceRef;
      presenceRef.on('value', function(snapshot) {
        var data = snapshot.val() || {};
        var counts = {};

        for (var key in data) {
          var userObj = data[key];
          if (userObj && userObj.cityId) {
            counts[userObj.cityId] = (counts[userObj.cityId] || 0) + 1;
          }
        }
        lastCityCounts = counts;
        renderCityList(document.getElementById('citySearch').value, counts);
      });
    }

    function renderCityList(filterKeyword, liveCounts) {
      var filter = filterKeyword || '';
      var listContainer = document.getElementById('cityList');
      if (!listContainer) return;

      listContainer.innerHTML = '';
      var t = I18N[currentLang] || I18N['ko'];

      var visibleCities = filter.trim() ? CITIES.concat(LEGACY_CITIES) : CITIES;
      for (var i = 0; i < visibleCities.length; i++) {
        var city = visibleCities[i];
        var name = getCityName(city);
        var desc = getCityDesc(city);
        var subText = typeof city.subCities === 'object' ? (city.subCities[currentLang] || city.subCities.ko) : (city.subCities || '');
        var activeCounts = liveCounts || lastCityCounts;
        var realCount = (activeCounts && activeCounts[city.id]) ? activeCounts[city.id] : 0;

        if (filter === '' || name.toLowerCase().indexOf(filter.toLowerCase()) !== -1 || subText.toLowerCase().indexOf(filter.toLowerCase()) !== -1 || Object.values(city.subCities || {}).join(' ').toLowerCase().indexOf(filter.toLowerCase()) !== -1) {
          var card = '<div onclick="openCityBoard(\'' + city.id + '\')" class="city-photo-card p-3.5 rounded-2xl border border-slate-200 shadow-sm hover:border-indigo-400 cursor-pointer flex items-center justify-between gap-3 w-full transition" style="' + (city.photo ? 'background-image:linear-gradient(90deg,rgba(255,255,255,.87) 0%,rgba(255,255,255,.87) 29%,rgba(255,255,255,.60) 39%,rgba(255,255,255,.08) 58%,rgba(255,255,255,0) 68%),url(&quot;'+city.photo+'&quot;)' : 'background:#fff') + '">' +
            '<div class="flex items-center gap-3 min-w-0 flex-1">' +
              '<div class="min-w-0 flex-1">' +
                '<div class="flex items-center gap-2">' +
                  '<h3 class="font-extrabold text-slate-900 text-base leading-tight">' + name + '</h3>' +
                  '<span class="text-[10px] city-online-badge bg-emerald-50 text-emerald-700 font-bold px-1.5 py-0.5 rounded-full border border-emerald-100 shrink-0">' + realCount + ' ' + t.online + '</span>' +
                '</div>' +
                '<p class="city-place-highlights text-[11px] font-bold mt-1 leading-snug">' + subText.split(' · ').map(function(item,idx){return '<span class="city-place-item city-place-color-'+(idx%3)+'">'+item+'</span>';}).join('<span class="city-place-separator"> · </span>') + '</p>' +
              '</div>' +
            '</div>' +
            '<div class="text-xs font-bold city-enter-label text-indigo-600 shrink-0 flex items-center gap-1 ml-1">' +
              '<span>' + t.enterShort + '</span>' +
              '<i class="fas fa-chevron-right text-[10px]"></i>' +
            '</div>' +
          '</div>';
          listContainer.innerHTML += card;
        }
      }
    }

    function openCityBoard(cityId) {
      if (!requireAuth()) return;
      for (var i = 0, allCities = CITIES.concat(LEGACY_CITIES); i < allCities.length; i++) {
        if (allCities[i].id === cityId) {
          currentCity = allCities[i];
          break;
        }
      }
      if (!currentCity) return;

      if (cityPresenceRef) cityPresenceRef.onDisconnect().cancel();
      cityPresenceRef = db.ref('presence/' + myUserId);
      cityPresenceRef.onDisconnect().remove();
      cityPresenceRef.set({ cityId: currentCity.id, lastSeen: firebase.database.ServerValue.TIMESTAMP }).catch(function(err) {
        console.error('Presence update failed:', err);
      });

      currentView = 'board';

      document.getElementById('homeView').classList.add('hidden');
      document.getElementById('roomListView').classList.add('hidden');
      document.getElementById('chatView').classList.add('hidden');
      document.getElementById('mapView').classList.add('hidden');
      document.getElementById('boardView').classList.remove('hidden');
      
      document.getElementById('backBtn').classList.remove('hidden');

      var cityName = getCityName(currentCity);
      var t = I18N[currentLang] || I18N['ko'];

      document.getElementById('headerTitle').innerText = cityName;
      document.getElementById('headerSub').innerText = t.boardSub;
      document.getElementById('boardBannerTitle').innerText = cityName + t.boardBannerSuffix;
      document.getElementById('boardBannerSub').innerText = t.boardBannerSub;
      document.getElementById('boardPostsTitle').innerHTML = t.boardPostsTitle;

      renderBoardPosts();
      startCommunityListener();
      selectBoardSection('notice');
      startOfficialNotices();
    }


    // v16: public, city-scoped community board. Uses textContent for all user input.
    var communityRef=null, communityCallback=null, communityData={};
    var communityOpenPost=null;
    var communityOpenComments=null;
    var communitySelectedPlace=null;
    var communityPlaceLocale={
      ko:['📍 장소 첨부 (선택)','장소명 또는 주소 검색','검색','첨부 취소','장소를 검색해 주세요.','검색 중...','장소를 찾지 못했습니다. 다른 이름이나 주소로 검색해 주세요.','지도 API 없이 장소명으로 첨부합니다. 게시글에서 지도 검색 링크를 열 수 있습니다.','첨부된 장소'],
      en:['📍 Attach a place (optional)','Search place name or address','Search','Remove place','Enter a place name.','Searching...','Place not found. Try another name or address.','Place attached by name; open the map search link in the post.','Attached place'],
      ja:['📍 場所を添付（任意）','場所名または住所を検索','検索','添付を解除','場所名を入力してください。','検索中...','場所が見つかりません。','場所名で添付します。投稿から地図検索できます。','添付した場所'],
      'zh-CN':['📍 添加地点（可选）','搜索地点名称或地址','搜索','移除地点','请输入地点名称。','搜索中...','未找到地点，请重试。','按地点名称添加，可从帖子打开地图搜索。','已添加地点']
    };
    function communityPlaceT(){return communityPlaceLocale[currentLang]||communityPlaceLocale.ko;}
    function communityPlaceLabels(){
      var t=communityPlaceT();
      document.getElementById('communityPlaceLabel').textContent=t[0];
      document.getElementById('communityPlaceQuery').placeholder=t[1];
      document.getElementById('communityPlaceSearch').textContent=t[2];
      document.getElementById('communityPlaceRemove').textContent=t[3];
      refreshCommunityPinLabels();
    }
    // v20.21: The board and chat share one in-app coordinate-based map picker.
    // A name-only attachment is deliberately not accepted.
    function refreshCommunityPinLabels(){}
    function resetCommunityPin(){}
    function applyCommunityGoogleLink(){openBoardPlacePicker();}
    function removeCommunityPlace(){
      communitySelectedPlace=null;
      document.getElementById('communityPlaceResult').textContent='';
      document.getElementById('communityPlaceRemove').classList.add('hidden');
    }
    function searchCommunityPlace(){openBoardPlacePicker();}
    function openBoardPlacePicker(){
      placePickerMode='board';
      selectedSharePlace=null;
      document.getElementById('selectedPlaceLabel').textContent=uiText('placeEmpty');
      document.getElementById('confirmSharePlace').disabled=true;
      document.getElementById('confirmSharePlace').textContent=currentLang==='ko'?'이 장소 첨부':currentLang==='en'?'Attach this place':currentLang==='ja'?'この場所を添付':'添加此地点';
      document.querySelector('#placePicker strong').textContent=currentLang==='ko'?'📍 게시글에 장소 첨부':'📍 Select a place';
      document.getElementById('placeSearchInput').value=document.getElementById('communityPlaceQuery').value;
      document.getElementById('placePicker').classList.remove('hidden');
      if(typeof google==='undefined'||!google.maps)loadGoogleMapsScript(currentLang,initSharePlaceMap);
      else initSharePlaceMap();
    }
    // v18.2: request the selected Local Talk UI language in external Google Maps links.
    // Google Maps app/account preferences may override this hint.
    function googleMapsLanguageParam(){
      var supported={'ko':'ko','en':'en','ja':'ja','zh-CN':'zh-CN'};
      return '&hl='+encodeURIComponent(supported[currentLang]||'ko');
    }
    function safeCommunityMapsUrl(raw){
      if(typeof raw!=='string')return null;
      try{var u=new URL(raw);if(u.protocol!=='https:')return null;
        if(u.hostname==='maps.app.goo.gl'||u.hostname==='goo.gl' || u.hostname==='maps.google.com'||/^www\.google\.[a-z.]+$/.test(u.hostname)||/^google\.[a-z.]+$/.test(u.hostname))return u.href;
      }catch(e){}return null;
    }
    // v20.23: View saved coordinates inside Local Talk; never navigate the APK WebView.
    function validSavedPlace(place){
      return place && place.lat!=null && place.lng!=null && place.lat!=='' && place.lng!=='' && Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lng)) &&
        Math.abs(Number(place.lat))<=90 && Math.abs(Number(place.lng))<=180;
    }
    // v20.25: Map viewer labels follow the selected Local Talk language.
    var viewerTranslations={
      ko:{place:'공유된 장소',close:'닫기',check:'📍 내 위치에서 거리 확인',again:'📍 거리 다시 확인',checking:'위치 확인 중…',hint:'버튼을 누를 때만 위치 권한을 요청합니다. (직선거리)',waiting:'휴대폰에서 위치 권한을 허용해 주세요.',unsupported:'이 기기에서는 위치 확인을 지원하지 않습니다.',denied:'위치 권한이 허용되지 않았습니다. 휴대폰의 앱 위치 권한 설정을 확인해 주세요.',timeout:'위치 확인 시간이 초과되었습니다. 다시 시도해 주세요.',unavailable:'현재 위치를 확인할 수 없습니다. 휴대폰 위치 서비스 및 앱 권한을 확인해 주세요.',insecure:'이 환경에서는 위치 확인이 제한되어 있습니다.',distance:'현재 위치에서 직선거리 약 ',suffix:' · 실제 이동거리는 다를 수 있습니다.',missing:'이전에 이름만으로 공유한 장소는 정확한 좌표가 없습니다. 작성자가 지도에서 핀을 다시 선택해야 합니다.',mapError:'지도를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'},
      en:{place:'Shared place',close:'Close',check:'📍 Check distance from my location',again:'📍 Check distance again',checking:'Finding location…',hint:'Location is requested only when you tap this button. (Straight-line distance)',waiting:'Please allow location access on your phone.',unsupported:'Location is not supported on this device.',denied:'Location access was denied. Check the app location permission in your phone settings.',timeout:'Location request timed out. Please try again.',unavailable:'Unable to get your location. Check phone location services and app permissions.',insecure:'Location is restricted in this environment.',distance:'Straight-line distance from your location: approx. ',suffix:' · Actual travel distance may differ.',missing:'This older place has no exact coordinates. The author needs to select a map pin.',mapError:'Could not load the map. Please try again.'},
      ja:{place:'共有された場所',close:'閉じる',check:'📍 現在地からの距離を確認',again:'📍 距離を再確認',checking:'位置を確認中…',hint:'ボタンを押した時だけ位置情報を要求します。（直線距離）',waiting:'端末の位置情報へのアクセスを許可してください。',unsupported:'この端末は位置情報に対応していません。',denied:'位置情報へのアクセスが拒否されました。アプリの権限設定を確認してください。',timeout:'位置情報の取得がタイムアウトしました。',unavailable:'現在地を取得できません。位置情報サービスとアプリの権限を確認してください。',insecure:'この環境では位置情報を利用できません。',distance:'現在地からの直線距離：約',suffix:' · 実際の移動距離とは異なります。',missing:'この場所には正確な座標がありません。',mapError:'地図を読み込めませんでした。'},
      'zh-CN':{place:'分享的位置',close:'关闭',check:'📍 查看距当前位置的距离',again:'📍 重新查看距离',checking:'正在获取位置…',hint:'仅点击按钮时请求定位权限。（直线距离）',waiting:'请允许手机访问位置信息。',unsupported:'此设备不支持定位。',denied:'定位权限被拒绝。请检查手机中的应用定位权限。',timeout:'定位超时，请重试。',unavailable:'无法获取当前位置。请检查手机定位服务和应用权限。',insecure:'当前环境限制定位功能。',distance:'距当前位置的直线距离约 ',suffix:' · 实际行程距离可能不同。',missing:'此旧地点没有准确坐标，请作者重新选取地图标记。',mapError:'地图加载失败，请重试。'}
    };
    function viewerT(){return viewerTranslations[currentLang]||viewerTranslations.ko;}
    var viewedPlace=null, viewedMap=null, viewedMarker=null;
    function viewPlaceInsideApp(place){
      if(!place)return;
      viewedPlace=place;
      var result=document.getElementById('viewPlaceDistanceResult');
      if(result)result.textContent=viewerT().hint;
      var distanceButton=document.getElementById('viewPlaceDistanceButton');
      if(distanceButton){distanceButton.disabled=false;distanceButton.textContent=viewerT().check;distanceButton.classList.toggle('hidden',!validSavedPlace(place));}
      var dialog=document.getElementById('placeViewer');
      document.getElementById('viewPlaceName').textContent='📍 '+String(place.name||viewerT().place);
      document.getElementById('viewPlaceAddress').textContent=String(place.address||'');
      var closeBtn=document.getElementById('viewPlaceCloseButton');if(closeBtn){closeBtn.setAttribute('aria-label',viewerT().close);closeBtn.title=viewerT().close;}
      document.getElementById('viewPlaceNoCoords').textContent=viewerT().missing;
      var valid=validSavedPlace(place);
      document.getElementById('viewPlaceNoCoords').classList.toggle('hidden',valid);
      document.getElementById('viewPlaceMap').classList.toggle('hidden',!valid);
      dialog.classList.remove('hidden');
      if(!valid)return;
      function draw(){
        if(dialog.classList.contains('hidden'))return;
        if(!window.google||!google.maps){
          document.getElementById('viewPlaceNoCoords').classList.remove('hidden');
          document.getElementById('viewPlaceNoCoords').textContent=viewerT().mapError;
          document.getElementById('viewPlaceMap').classList.add('hidden');return;
        }
        var pos={lat:Number(place.lat),lng:Number(place.lng)};
        viewedMap=new google.maps.Map(document.getElementById('viewPlaceMap'),{
          center:pos,zoom:16,streetViewControl:false,mapTypeControl:false,fullscreenControl:false
        });
        viewedMarker=new google.maps.Marker({map:viewedMap,position:pos,title:String(place.name||viewerT().place)});
      }
      if(window.google&&google.maps)draw();else loadGoogleMapsScript(currentLang,draw);
    }
    // v20.24: Only request device location after a deliberate button press.
    function checkViewedPlaceDistance(){
      var place=viewedPlace;
      if(!validSavedPlace(place))return;
      var output=document.getElementById('viewPlaceDistanceResult');
      var button=document.getElementById('viewPlaceDistanceButton');
      if(!output||!button)return;
      if(!navigator.geolocation){output.textContent=viewerT().unsupported;return;}
      button.disabled=true;
      button.textContent=viewerT().checking;
      output.textContent=viewerT().waiting;
      if(!window.isSecureContext){output.textContent=viewerT().insecure;button.disabled=false;button.textContent=viewerT().again;return;}
      navigator.geolocation.getCurrentPosition(function(position){
        if(viewedPlace!==place)return;
        var rad=Math.PI/180;
        var lat1=position.coords.latitude*rad,lat2=Number(place.lat)*rad;
        var dLat=lat2-lat1,dLng=(Number(place.lng)-position.coords.longitude)*rad;
        var a=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
        var km=6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));
        output.textContent=viewerT().distance+(km<1?Math.round(km*1000).toLocaleString()+'m':km.toFixed(1)+'km')+viewerT().suffix;
        button.textContent=viewerT().again;button.disabled=false;
      },function(error){
        if(viewedPlace!==place)return;
        output.textContent=error.code===1?viewerT().denied:error.code===3?viewerT().timeout:viewerT().unavailable;
        button.textContent=viewerT().again;button.disabled=false;
      },{enableHighAccuracy:false,timeout:12000,maximumAge:60000});
    }
    function closePlaceViewer(){
      document.getElementById('placeViewer').classList.add('hidden');
      viewedPlace=null;viewedMap=null;viewedMarker=null;
    }
    function communityPlaceCard(place){
      if(!place||typeof place.name!=='string'||!place.name.trim())return null;
      var wrap=communityEl('div','rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-2');
      wrap.appendChild(communityEl('p','text-sm font-bold text-emerald-900 break-words','📍 '+place.name));
      if(place.address)wrap.appendChild(communityEl('p','text-xs text-emerald-800 break-words',place.address));
      var btn=communityBtn(currentLang==='ko'?'지도에서 위치 보기':'View on map',function(){viewPlaceInsideApp(place);},
        'w-full rounded-lg bg-emerald-700 text-white text-sm font-bold px-3 py-3');
      wrap.appendChild(btn);return wrap;
    }
    var communityLocale={
      ko:{heading:'여행자 게시판',newPost:'+ 글쓰기',title:'제목 (최대 100자)',body:'여행 질문이나 정보를 공유해 주세요 (최대 3,000자)',cancel:'취소',publish:'등록',empty:'아직 게시글이 없습니다. 첫 글을 남겨보세요!',loading:'게시글을 불러오는 중...',auth:'로그인 연결 후 다시 시도해 주세요.',required:'제목과 내용을 입력해 주세요.',error:'저장에 실패했습니다. 잠시 후 다시 시도해 주세요.',delete:'삭제',edit:'수정',save:'저장',comment:'댓글',commentHint:'댓글을 입력해 주세요 (최대 1,000자)',send:'댓글 등록',deleteAsk:'정말 삭제하시겠습니까?',anonymous:'여행자',replyEmpty:'아직 댓글이 없습니다.',mine:'내 글',editing:'게시글 수정'},
      en:{heading:'Traveler board',newPost:'+ New post',title:'Title (up to 100 characters)',body:'Share travel questions or tips (up to 3,000 characters)',cancel:'Cancel',publish:'Publish',empty:'No posts yet. Start the conversation!',loading:'Loading posts...',auth:'Please wait for sign-in.',required:'Enter a title and message.',error:'Could not save. Please try again.',delete:'Delete',edit:'Edit',save:'Save',comment:'Comments',commentHint:'Write a comment (up to 1,000 characters)',send:'Post comment',deleteAsk:'Delete this item?',anonymous:'Traveler',replyEmpty:'No comments yet.',mine:'My post',editing:'Edit post'},
      ja:{heading:'旅行者掲示板',newPost:'+ 投稿する',title:'タイトル（100文字以内）',body:'旅行の質問や情報を共有（3,000文字以内）',cancel:'キャンセル',publish:'投稿',empty:'まだ投稿がありません。最初の投稿をどうぞ！',loading:'投稿を読み込み中...',auth:'ログイン完了後にお試しください。',required:'タイトルと本文を入力してください。',error:'保存できませんでした。もう一度お試しください。',delete:'削除',edit:'編集',save:'保存',comment:'コメント',commentHint:'コメントを入力（1,000文字以内）',send:'コメント投稿',deleteAsk:'削除しますか？',anonymous:'旅行者',replyEmpty:'コメントはまだありません。',mine:'自分の投稿',editing:'投稿を編集'},
      'zh-CN':{heading:'旅行者论坛',newPost:'+ 发帖',title:'标题（最多100字）',body:'分享旅行问题或建议（最多3,000字）',cancel:'取消',publish:'发布',empty:'暂无帖子，欢迎发表第一篇！',loading:'正在加载帖子...',auth:'请等待登录完成。',required:'请输入标题和内容。',error:'保存失败，请重试。',delete:'删除',edit:'编辑',save:'保存',comment:'评论',commentHint:'输入评论（最多1,000字）',send:'发表评论',deleteAsk:'确定删除吗？',anonymous:'旅行者',replyEmpty:'暂无评论。',mine:'我的帖子',editing:'编辑帖子'}
    };
    function communityT(){return communityLocale[currentLang]||communityLocale.ko;}
    function communityEl(tag,cls,txt){
      var e=document.createElement(tag);
      if(cls)e.className=cls;
      if(txt!==undefined)e.textContent=txt;
      return e;
    }
    function communityBtn(text,fn,cls){
      var b=communityEl('button',cls||'text-indigo-600 text-xs font-bold px-2 py-1',text);
      b.type='button';b.addEventListener('click',fn);return b;
    }
    function communityStatus(msg){document.getElementById('communityStatus').textContent=msg||'';}
    function communityLabels(){
      var t=communityT();
      communityPlaceLabels();
      var pairs={communityHeading:t.heading,communityNewButton:t.newPost,communityCancelButton:t.cancel,communityPublishButton:t.publish};
      Object.keys(pairs).forEach(function(id){document.getElementById(id).textContent=pairs[id];});
      document.getElementById('communityPostTitle').placeholder=t.title;
      document.getElementById('communityPostBody').placeholder=t.body;
    }
    function toggleCommunityComposer(force){
      var box=document.getElementById('communityComposer');
      var show=typeof force==='boolean'?force:box.classList.contains('hidden');
      box.classList.toggle('hidden',!show);
      if(show){document.body.appendChild(box);document.getElementById('communityPostTitle').focus();}
      else removeCommunityPlace();
    }
    function stopCommunityListener(){
      if(communityRef && communityCallback)communityRef.off('value',communityCallback);
      communityRef=null;communityCallback=null;
    }
    function startCommunityListener(){
      if(!currentCity||!requireAuth())return;
      stopCommunityListener();
      communityLabels();
      communityStatus(communityT().loading);
      communityData={};
      communityOpenPost=null;
      communityOpenComments=null;
      communityRef=db.ref('communityPosts/'+currentCity.id);
      communityCallback=function(snapshot){
        communityData=snapshot.val()||{};
        communityStatus('');
        renderCommunityPosts();
      };
      communityRef.on('value',communityCallback,function(err){
        console.error('Community read failed',err);
        communityStatus(communityT().error);
      });
    }
    function communityAuthor(){return (userCountry?userCountry+' ':'')+(userNickname||communityT().anonymous);}
    function publishCommunityPost(){
      if(!currentCity||!requireAuth()){alert(communityT().auth);return;}
      var title=document.getElementById('communityPostTitle').value.trim();
      var body=document.getElementById('communityPostBody').value.trim();
      if(!title||!body){alert(communityT().required);return;}
      var btn=document.getElementById('communityPublishButton');btn.disabled=true;
      var ref=db.ref('communityPosts/'+currentCity.id).push();
      var data={uid:myUserId,author:communityAuthor().slice(0,100),title:title.slice(0,100),body:body.slice(0,3000),createdAt:firebase.database.ServerValue.TIMESTAMP};
      if(communitySelectedPlace&&Number.isFinite(communitySelectedPlace.lat)&&Number.isFinite(communitySelectedPlace.lng))data.place=Object.assign({},communitySelectedPlace);
      ref.set(data)
        .then(function(){
          document.getElementById('communityPostTitle').value='';
          document.getElementById('communityPostBody').value='';
          document.getElementById('communityPlaceQuery').value='';
          resetCommunityPin();

          toggleCommunityComposer(false);
        }).catch(function(err){console.error(err);alert(communityT().error);})
        .finally(function(){btn.disabled=false;});
    }
    function deleteCommunityPost(id){
      if(!currentCity||!requireAuth()||!communityData[id])return;
      if(communityData[id].uid!==myUserId && !officialIsAdmin)return;
      if(communityData[id].uid!==myUserId){adminRemoveCommunityContent('post',id,null);return;}
      if(!confirm(communityT().deleteAsk))return;
      db.ref('communityPosts/'+currentCity.id+'/'+id).remove().catch(function(e){console.error(e);alert(communityT().error);});
    }
    var communityEditingPost=null;
    function editCommunityPost(id){
      var post=communityData[id];
      if(!post||post.uid!==myUserId)return;
      communityEditingPost=id;
      renderCommunityPosts();
    }
    function extractCommunityMapCoordinates(raw){
      try{var u=new URL(raw),decoded=decodeURIComponent(u.href),m=decoded.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
        if(!m){for(var k of ['query','q','ll','center']){var val=u.searchParams.get(k);if(val){m=val.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);if(m)break;}}}
        if(!m)m=decoded.match(/\/maps\/(?:search|place)\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
        if(!m)return null;var lat=Number(m[1]),lng=Number(m[2]);return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?{lat:lat,lng:lng}:null;
      }catch(e){return null;}
    }
    function saveCommunityEdit(id,titleField,bodyField,saveBtn,placeNameField,placeUrlField){
      var post=communityData[id];
      if(!post||post.uid!==myUserId||!currentCity)return;
      var title=titleField.value.trim(),body=bodyField.value.trim();
      if(!title||!body||title.length>100||body.length>3000){alert(communityT().required);return;}
      var placeName=placeNameField.value.trim(),rawUrl=placeUrlField.value.trim();
      if(rawUrl&&!safeCommunityMapsUrl(rawUrl)){alert('Google Maps HTTPS 링크를 입력해 주세요.');return;}
      if(rawUrl&&!placeName){alert('장소 이름도 입력해 주세요.');return;}
      var updates={title:title,body:body};
      if(placeName){
        updates.place={name:placeName.slice(0,150),address:placeName.slice(0,150)};
        if(rawUrl){updates.place.url=rawUrl;var parsed=extractCommunityMapCoordinates(rawUrl);if(parsed){updates.place.lat=parsed.lat;updates.place.lng=parsed.lng;}}
        // Retain coordinates only when editing the same previously attached place and link.
        if(!Number.isFinite(updates.place.lat)&&post.place&&post.place.name===placeName&&(!rawUrl||rawUrl===post.place.url)&&Number.isFinite(post.place.lat)&&Number.isFinite(post.place.lng)){
          updates.place.lat=post.place.lat;updates.place.lng=post.place.lng;
        }
      }else updates.place=null;
      saveBtn.disabled=true;
      db.ref('communityPosts/'+currentCity.id+'/'+id).update(updates)
        .then(function(){communityEditingPost=null;var modal=document.getElementById('communityEditModal');if(modal)modal.remove();renderCommunityPosts();})
        .catch(function(e){console.error(e);alert(communityT().error);})
        .finally(function(){saveBtn.disabled=false;});
    }
    function publishCommunityComment(postId,field,btn){
      if(!currentCity||!requireAuth())return;
      var text=field.value.trim();
      if(!text||text.length>1000)return;
      btn.disabled=true;
      db.ref('communityPosts/'+currentCity.id+'/'+postId+'/comments').push()
        .set({uid:myUserId,author:communityAuthor().slice(0,100),text:text,createdAt:firebase.database.ServerValue.TIMESTAMP})
        .then(function(){field.value='';}).catch(function(e){console.error(e);alert(communityT().error);})
        .finally(function(){btn.disabled=false;});
    }
    function deleteCommunityComment(postId,commentId){
      var post=communityData[postId],comment=post&&post.comments&&post.comments[commentId];
      if(!comment||!(comment.uid===myUserId||officialIsAdmin))return;
      if(comment.uid!==myUserId){adminRemoveCommunityContent('comment',postId,commentId);return;}
      if(!confirm(communityT().deleteAsk))return;
      db.ref('communityPosts/'+currentCity.id+'/'+postId+'/comments/'+commentId).remove()
        .catch(function(e){console.error(e);alert(communityT().error);});
    }
    // Admin moderation: log and deletion in one multi-location database update.
    // Test with a separate Firebase test project before enabling in production.
    function adminRemoveCommunityContent(kind,postId,commentId){
      if(!officialIsAdmin||!auth.currentUser||!currentCity)return;
      var post=communityData[postId];
      var target=kind==='post'?post:(post&&post.comments&&post.comments[commentId]);
      if(!target)return;
      var reasons=currentLang==='ko'?'삭제 사유를 입력하세요 (필수).':'Enter moderation reason (required).';
      var reason=prompt(reasons);
      if(reason===null)return;
      reason=reason.trim();
      if(!reason||reason.length>200){alert(currentLang==='ko'?'삭제 사유는 1~200자로 입력하세요.':'Reason must be 1–200 characters.');return;}
      if(!confirm(communityT().deleteAsk))return;
      var cityId=currentCity.id;
      var record={adminUid:auth.currentUser.uid,kind:kind,cityId:cityId,postId:postId,
        targetUid:target.uid||'',reason:reason,createdAt:firebase.database.ServerValue.TIMESTAMP};
      if(kind==='comment')record.commentId=commentId;
      var targetPath='communityPosts/'+cityId+'/'+postId+(kind==='comment'?'/comments/'+commentId:'');
      var logRef=db.ref('moderationLogs').push();
      var changes={};
      changes['moderationLogs/'+logRef.key]=record;
      changes[targetPath]=null;
      // RTDB multi-location update is all-or-nothing at the database level.
      db.ref().update(changes).catch(function(err){
        console.error('Moderation delete failed',err);
        alert(communityT().error);
      });
    }
    // Display-only translation. The original text remains in Firebase and editors.
    function boardDisplayText(el, original, key, lazy){
      el.dataset.sourceText=original;
      el.dataset.boardTranslationKey=key;
      if(lazy)return el;
      boardTranslateElement(el);
      return el;
    }
    function boardTranslateElement(el){
      var original=el.dataset.sourceText, lang=currentLang;
      if(!original || !autoTranslateEnabled)return;
      translateMsg('board:'+el.dataset.boardTranslationKey,original,lang,false).then(function(result){
        if(el.isConnected && currentLang===lang && el.dataset.sourceText===original && autoTranslateEnabled){
          el.textContent=result;
          el.title=original;
        }
      }).catch(function(){ /* On failure retain the original. */ });
    }
    var communitySearchText='';
    function communitySearchChanged(value){communitySearchText=value;renderCommunityPosts();}
    function communitySearchLabels(){return ({ko:['여행자 글 검색 (제목·내용·장소)','검색 결과가 없습니다.'],en:['Search traveler posts (title, text, place)','No matching posts.'],ja:['旅行者の投稿を検索（タイトル・本文・場所）','検索結果がありません'], 'zh-CN':['搜索旅行者帖子（标题、内容、地点）','没有搜索结果']})[currentLang]||['여행자 글 검색','검색 결과가 없습니다.'];}
    function updateBoardSearchCount(n){var el=document.getElementById('boardSearchCount');if(el)el.textContent=n+' '+({ko:'개',en:'results',ja:'件','zh-CN':'条'}[currentLang]||'개');}
    // v20.31 board reports: separate append-only channel; no public report reads.
    function communityReportLabel(){return ({ko:'신고',en:'Report',ja:'通報','zh-CN':'举报'})[currentLang]||'Report';}
    function submitCommunityReport(kind,postId,commentId){
      if(!requireAuth()||!currentCity)return;
      var post=communityData[postId];
      var target=kind==='comment'?(post&&post.comments&&post.comments[commentId]):post;
      if(!target||!target.uid||target.uid===myUserId)return;
      var labels=safetyText();
      var choices=labels.reasons;
      var menu=choices.map(function(label,i){return i+': '+label;}).join('\n');
      var answer=window.prompt(labels.reason+'\n'+menu,'0');
      if(answer===null)return;
      answer=answer.trim();
      if(!/^[0-3]$/.test(answer)){alert(labels.reason+' (0-3)');return;}
      var report={reporterUid:myUserId,reportedUid:target.uid,cityId:currentCity.id,
        kind:kind,postId:postId,commentId:kind==='comment'?commentId:'',reason:answer,
        contentText:String(kind==='comment'?target.text:(target.title+'\n'+target.body)).slice(0,2000),
        sender:String(target.author||'').slice(0,100),createdAt:firebase.database.ServerValue.TIMESTAMP};
      db.ref('communityReports').push().set(report).then(function(){alert(labels.success);})
        .catch(function(e){console.error('Community report failed',e);alert(labels.error);});
    }


    // v20.32: admin-only report queue. Firebase rules are the actual authorization boundary.
    var adminReportItems=[];
    var adminReportStatuses={};
    function closeAdminReports(){
      var modal=document.getElementById('adminReportsModal');
      if(modal)modal.classList.add('hidden');
    }
    function openAdminReports(){
      if(!officialIsAdmin||!auth.currentUser)return;
      var profile=document.getElementById('profileModal');if(profile)profile.classList.add('hidden');
      document.getElementById('adminReportsModal').classList.remove('hidden');
      document.getElementById('adminReportsList').textContent='신고 내역을 불러오는 중...';
      Promise.all([db.ref('communityReports').limitToLast(100).once('value'),db.ref('communityReportStatuses').once('value')]).then(function(results){
        if(!officialIsAdmin||document.getElementById('adminReportsModal').classList.contains('hidden'))return;
        var raw=results[0].val()||{};
        adminReportItems=Object.keys(raw).map(function(id){return {id:id,data:raw[id]};}).sort(function(a,b){return (b.data.createdAt||0)-(a.data.createdAt||0);});
        adminReportStatuses=results[1].val()||{};
        renderAdminReports();
      }).catch(function(e){console.error('Admin report read',e);document.getElementById('adminReportsList').textContent='신고 목록을 읽지 못했습니다. Firebase 테스트 규칙을 게시했는지 확인하세요.';});
    }
    function renderAdminReports(){
      var root=document.getElementById('adminReportsList');root.replaceChildren();
      var pending=adminReportItems.filter(function(item){return !adminReportStatuses[item.id];}).length;
      document.getElementById('adminReportCount').textContent='(미처리 '+pending+' / 최근 '+adminReportItems.length+'건)';
      if(!adminReportItems.length){root.textContent='접수된 신고가 없습니다.';return;}
      adminReportItems.forEach(function(item){
        var d=item.data||{},st=adminReportStatuses[item.id];
        var card=document.createElement('div');card.className='border border-slate-200 rounded-xl p-3 space-y-2';
        var heading=document.createElement('div');heading.className='font-bold text-slate-800';
        heading.textContent=(d.kind==='comment'?'댓글':'게시글')+' 신고 · '+(d.cityId||'')+' · '+(st?'처리 완료':'미처리');card.appendChild(heading);
        var meta=document.createElement('p');meta.className='text-xs text-slate-500';
        var reasons=['괴롭힘·욕설','스팸·광고','부적절한 내용','기타'];
        meta.textContent='사유: '+(reasons[Number(d.reason)]||'기타')+' · '+(d.createdAt?new Date(d.createdAt).toLocaleString():'날짜 없음');card.appendChild(meta);
        var content=document.createElement('div');content.className='bg-slate-50 rounded-lg p-2 text-sm whitespace-pre-wrap break-words';content.textContent=String(d.contentText||'').slice(0,2000);card.appendChild(content);
        var author=document.createElement('p');author.className='text-xs text-slate-500 break-all';author.textContent='작성자: '+(d.sender||'알 수 없음')+' · 글 ID: '+(d.postId||'');card.appendChild(author);
        if(!st){
          var controls=document.createElement('div');controls.className='flex gap-2 flex-wrap';
          var review=document.createElement('button');review.type='button';review.className='px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs';review.textContent='검토 완료 (삭제 안 함)';review.onclick=function(){adminResolveReport(item,'reviewed');};controls.appendChild(review);
          var remove=document.createElement('button');remove.type='button';remove.className='px-3 py-2 rounded-lg bg-red-600 text-white text-xs';remove.textContent='신고 대상 삭제';remove.onclick=function(){adminResolveReport(item,'deleted');};controls.appendChild(remove);
          card.appendChild(controls);
        }else{var done=document.createElement('p');done.className='text-xs text-slate-500';done.textContent='처리: '+(st.action==='deleted'?'삭제':'검토 완료');card.appendChild(done);}
        root.appendChild(card);
      });
    }
    // Pre-deployment safeguard: never trust report IDs or target identity blindly.
    function adminResolveReport(item,action){
      if(!officialIsAdmin||!auth.currentUser)return;
      if(action!=='reviewed'&&action!=='deleted')return;
      var d=(item&&item.data)||{},reportId=item&&item.id;
      function validKey(s){return typeof s==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(s);}
      if(!validKey(reportId)||!validKey(d.cityId)||!validKey(d.postId)||
         !['post','comment'].includes(d.kind)||
         (d.kind==='comment'&&!validKey(d.commentId))){
        alert('신고 ID 또는 대상 경로가 올바르지 않습니다. 삭제를 중단합니다.');return;
      }
      var statusPath='communityReportStatuses/'+reportId;
      Promise.all([
        db.ref('communityReports/'+reportId).once('value'),
        db.ref(statusPath).once('value')
      ]).then(function(results){
        var current=results[0].val();
        if(!current||results[1].exists()){
          alert('신고가 없거나 이미 처리되었습니다. 목록을 새로 확인하세요.');return;
        }
        if(current.kind!==d.kind||current.cityId!==d.cityId||
           current.postId!==d.postId||current.commentId!==d.commentId||
           current.reportedUid!==d.reportedUid){
          alert('신고 내용이 변경되어 처리를 중단합니다.');return;
        }
        var uid=auth.currentUser.uid;
        var status={adminUid:uid,action:action,createdAt:firebase.database.ServerValue.TIMESTAMP};
        if(action==='reviewed'){
          if(!confirm('이 신고를 검토 완료로 표시할까요?'))return;
          return db.ref(statusPath).set(status).then(openAdminReports);
        }
        var targetPath='communityPosts/'+current.cityId+'/'+current.postId+
          (current.kind==='comment'?'/comments/'+current.commentId:'');
        return db.ref(targetPath).once('value').then(function(snap){
          var target=snap.val();
          if(!target||typeof target!=='object'||target.uid!==current.reportedUid){
            alert('신고 대상이 없거나 작성자 정보가 일치하지 않습니다. 삭제하지 않았습니다.');return;
          }
          var preview=String(current.kind==='comment'?target.text:target.title||'').slice(0,120);
          if(!confirm('실제 게시물과 작성자 정보를 확인했습니다.\n'+
                      '대상: '+preview+'\n\n이 콘텐츠를 삭제하고 처리 기록을 남길까요?'))return;
          var log={adminUid:uid,kind:current.kind,cityId:current.cityId,
                   postId:current.postId,targetUid:current.reportedUid||'',
                   reason:'신고',createdAt:firebase.database.ServerValue.TIMESTAMP};
          if(current.kind==='comment')log.commentId=current.commentId;
          var changes={};
          changes[statusPath]=status;
          changes[targetPath]=null;
          changes['moderationLogs/'+db.ref('moderationLogs').push().key]=log;
          return db.ref().update(changes).then(openAdminReports);
        });
      }).catch(function(e){
        console.error('Report moderation failed',e);
        alert('처리 실패: 권한 또는 데이터 상태를 확인하세요.');
      });
    }

    function renderCommunityPosts(){
      communityLabels();
      var oldEditModal=document.getElementById('communityEditModal');if(oldEditModal)oldEditModal.remove();
      var container=document.getElementById('communityPosts');
      container.replaceChildren();
      if(!currentCity)return;
      var t=communityT();
      var entries=Object.keys(communityData).map(function(id){return {id:id,post:communityData[id]};})
        .filter(function(x){return x.post&&typeof x.post.title==='string'&&typeof x.post.body==='string';})
        .sort(function(a,b){return (b.post.createdAt||0)-(a.post.createdAt||0);})
        .slice(0,200)
        .filter(function(item){
          var q=communitySearchText.trim().toLowerCase();
          if(!q)return true;
          var post=item.post, place=post.place||{};
          var haystack=[post.title,post.body,place.name,place.address,place.title].filter(Boolean).join(' ').toLowerCase();
          var aliasGroups=[['명동','myeongdong','myungdong','明洞','ミョンドン'],['홍대','hongdae','hongik','弘大','ホンデ'],['강남','gangnam','江南','カンナム'],['부산','busan','釜山'],['제주','jeju','済州','济州']];
          aliasGroups.forEach(function(group){if(group.some(function(word){return haystack.includes(word.toLowerCase());}))haystack+=' '+group.join(' ').toLowerCase();});
          return haystack.includes(q);
        });
      if(boardSection==='traveler')updateBoardSearchCount(entries.length);
      if(!entries.length){container.appendChild(communityEl('p','bg-white rounded-xl p-4 text-sm text-slate-500',communitySearchText.trim()?communitySearchLabels()[1]:t.empty));return;}
      entries.forEach(function(item){
        var id=item.id,p=item.post;
        var card=communityEl('article','bg-white border border-slate-200 rounded-2xl p-4 space-y-2 shadow-sm');
        var expanded=communityOpenPost===id;
        var commentsExpanded=communityOpenComments===id;
        var heading=communityEl('button','w-full flex items-center justify-between gap-3 text-left');
        heading.type='button';
        heading.setAttribute('aria-expanded',String(expanded));
        heading.setAttribute('aria-label',p.title+' - '+boardExpandLabel(expanded));
        var title=communityEl('h4','font-bold text-slate-800 text-sm break-words flex-1',p.title);
        var arrow=communityEl('span','text-indigo-600 font-semibold shrink-0', boardExpandLabel(expanded));
        arrow.style.fontSize='13px';
        arrow.style.whiteSpace='nowrap';
        boardDisplayText(title,p.title,'community:'+id+':title');heading.appendChild(title);heading.appendChild(arrow);
        heading.addEventListener('click',function(){communityOpenPost=expanded?null:id;renderCommunityPosts();});
        card.appendChild(heading);
        if(communityEditingPost===id && p.uid===myUserId){
          var editor=communityEl('div','lt-modal');editor.id='communityEditModal';var editCard=communityEl('div','lt-modal-card space-y-3');editor.appendChild(editCard);
          var titleField=communityEl('input','w-full border rounded-lg p-3 text-sm');
          titleField.maxLength=100;titleField.value=p.title;titleField.placeholder=t.title;
          var bodyField=communityEl('textarea','w-full border rounded-lg p-3 text-sm');
          bodyField.maxLength=3000;bodyField.rows=7;bodyField.value=p.body;bodyField.placeholder=t.body;
          var placeLabel=communityEl('label','block text-sm font-bold text-emerald-900','📍 '+(currentLang==='ko'?'첨부 장소 수정 (선택)':'Edit attached place (optional)'));
          var placeNameField=communityEl('input','w-full border rounded-lg p-3 text-sm');placeNameField.maxLength=150;placeNameField.placeholder='장소명 / Place name';placeNameField.value=(p.place&&p.place.name)||'';
          var placeUrlField=communityEl('input','w-full border rounded-lg p-3 text-sm');placeUrlField.type='url';placeUrlField.maxLength=2000;placeUrlField.placeholder='Google Maps 공유 링크';placeUrlField.value=(p.place&&p.place.url)||'';
          var placeHint=communityEl('p','text-xs text-slate-500','장소명을 지우고 저장하면 장소 첨부가 삭제됩니다. / Clear place name to remove.');
          var saveBtn=communityBtn(t.save,function(){saveCommunityEdit(id,titleField,bodyField,saveBtn,placeNameField,placeUrlField);},'bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-bold');
          var cancelBtn=communityBtn(t.cancel,function(){communityEditingPost=null;editor.remove();renderCommunityPosts();},'bg-white rounded-lg px-4 py-2 text-sm font-bold');
          editCard.appendChild(communityEl('h3','font-bold text-slate-800',t.edit));editCard.appendChild(titleField);editCard.appendChild(bodyField);editCard.appendChild(placeLabel);editCard.appendChild(placeNameField);editCard.appendChild(placeUrlField);editCard.appendChild(placeHint);editCard.appendChild(saveBtn);editCard.appendChild(cancelBtn);
          document.body.appendChild(editor);
        }
        var date=typeof p.createdAt==='number'?new Date(p.createdAt).toLocaleDateString(currentLang):'';
        card.appendChild(communityEl('p','text-xs text-slate-500',String(p.author||t.anonymous)+' · '+date));
        var actions=communityEl('div','flex gap-2 items-center flex-wrap');
        var comments=p.comments||{};
        actions.appendChild(communityBtn(t.comment+' ('+Object.keys(comments).length+')',function(){communityOpenComments=commentsExpanded?null:id;renderCommunityPosts();}));
        if(p.uid && p.uid!==myUserId)actions.appendChild(communityBtn(communityReportLabel(),function(){submitCommunityReport('post',id,'');},'text-amber-700 text-xs font-bold px-2 py-1'));
        if(p.uid===myUserId){
          actions.appendChild(communityBtn(t.edit,function(){editCommunityPost(id);}));
          actions.appendChild(communityBtn(t.delete,function(){deleteCommunityPost(id);},'text-red-600 text-xs font-bold px-2 py-1'));
        }
        if(officialIsAdmin && p.uid!==myUserId){
          actions.appendChild(communityBtn(t.delete+' (Admin)',function(){deleteCommunityPost(id);},'text-red-600 text-xs font-bold px-2 py-1'));
        }
        card.appendChild(actions);
        if(expanded){
          var body=communityEl('p','text-sm text-slate-700 whitespace-pre-wrap break-words bg-slate-50 rounded-xl p-3',p.body);
          boardDisplayText(body,p.body,'community:'+id+':body');card.insertBefore(body,actions);
          var placeCard=communityPlaceCard(p.place);
          if(placeCard)card.insertBefore(placeCard,actions);
        }
        if(commentsExpanded){
          var commentBox=communityEl('div','space-y-2 border-t pt-3');
          Object.keys(comments).sort(function(a,b){return (comments[a].createdAt||0)-(comments[b].createdAt||0);}).forEach(function(cid){
            var c=comments[cid];
            if(!c||typeof c.text!=='string')return;
            var line=communityEl('div','bg-slate-50 rounded-lg p-2 text-xs');
            line.appendChild(communityEl('div','font-semibold text-slate-600',c.author||t.anonymous));
            line.appendChild(boardDisplayText(communityEl('p','whitespace-pre-wrap break-words mt-1',c.text),c.text,'community:'+id+':comment:'+cid));
            if(c.uid && c.uid!==myUserId)line.appendChild(communityBtn(communityReportLabel(),function(){submitCommunityReport('comment',id,cid);},'text-amber-700 text-xs mt-1 mr-2'));
            if(c.uid===myUserId||officialIsAdmin)line.appendChild(communityBtn(t.delete+(c.uid!==myUserId?' (Admin)':''),function(){deleteCommunityComment(id,cid);},'text-red-600 text-xs mt-1'));
            commentBox.appendChild(line);
          });
          if(!Object.keys(comments).length)commentBox.appendChild(communityEl('p','text-xs text-slate-400',t.replyEmpty));
          var field=communityEl('textarea','w-full border rounded-xl p-3 text-sm');
          field.maxLength=1000;field.rows=2;field.placeholder=t.commentHint;
          var submit=communityBtn(t.send,function(){publishCommunityComment(id,field,submit);},'bg-indigo-600 text-white rounded-lg px-3 py-2 text-xs font-bold');
          commentBox.appendChild(field);commentBox.appendChild(submit);card.appendChild(commentBox);
        }
        container.appendChild(card);
      });
    }


    // v20.4 official notices: Google provider + server-side UID allowlist.
    var officialRef=null,officialListener=null,officialData={},officialIsAdmin=false,officialEditId=null;
    var boardSection='notice';
    function officialL(){
      return ({
        ko:['📢 공지 & 팁','💬 여행자 게시판','관리자 Google 로그인','관리자 인증 완료','관리자 계정이 허용 목록에 없습니다. Firebase 관리자 UID 등록이 필요합니다.','공식 공지는 관리자만 작성할 수 있습니다.','제목과 내용을 입력하세요.','저장에 실패했습니다.','삭제할까요?','수정','삭제','저장','취소','공지 등록'],
        en:['📢 Notices & tips','💬 Traveler board','Admin Google sign-in','Admin verified','This Google UID is not approved in Firebase.','Only administrators can publish official notices.','Enter a title and content.','Could not save.','Delete this notice?','Edit','Delete','Save','Cancel','Publish notice'],
        ja:['📢 お知らせ・ヒント','💬 旅行者掲示板','管理者Googleログイン','管理者認証済み','このGoogleアカウントは管理者登録されていません。','公式お知らせは管理者のみ投稿できます。','タイトルと本文を入力してください。','保存できませんでした。','削除しますか？','編集','削除','保存','キャンセル','お知らせ投稿'],
        'zh-CN':['📢 公告与提示','💬 旅行者论坛','管理员Google登录','管理员已验证','此Google账号未被授权。','只有管理员可以发布公告。','请输入标题和内容。','保存失败。','确定删除吗？','编辑','删除','保存','取消','发布公告']
      })[currentLang]||({ko:['📢 공지 & 팁','💬 여행자 게시판','관리자 Google 로그인','관리자 인증 완료','관리자 계정이 허용 목록에 없습니다. Firebase 관리자 UID 등록이 필요합니다.','공식 공지는 관리자만 작성할 수 있습니다.','제목과 내용을 입력하세요.','저장에 실패했습니다.','삭제할까요?','수정','삭제','저장','취소','공지 등록']}).ko;
    }
    function selectBoardSection(section){
      boardSection=section==='traveler'?'traveler':'notice';
      var n=boardSection==='notice', t=officialL();
      document.getElementById('boardNoticePanel').classList.toggle('hidden',!n);
      document.getElementById('boardTravelerPanel').classList.toggle('hidden',n);
      document.getElementById('communityToolbar').classList.toggle('hidden',n);
      document.getElementById('officialSearchControls').classList.toggle('hidden',!n);
      document.getElementById('communitySearchControls').classList.toggle('hidden',n);
      if(n)updateBoardSearchCount(Object.keys(officialData).length);else updateBoardSearchCount(Object.keys(communityData).length);
      ['boardNoticeTab','boardTravelerTab'].forEach(function(id,i){
        var selected=i===(n?0:1), el=document.getElementById(id);
        el.className='rounded-xl py-2 text-sm font-bold '+(selected?'bg-indigo-600 text-white':'bg-white border text-slate-700');
        el.setAttribute('aria-selected',String(selected));
        el.textContent=t[i];
      });
      document.getElementById('boardScrollablePosts').scrollTop=0;
    }
    function officialButton(label,handler,red){
      var b=document.createElement('button');b.type='button';b.textContent=label;
      b.className=(red?'text-red-600':'text-indigo-700')+' text-xs font-bold px-2 py-2';
      b.onclick=handler;return b;
    }
    function startOfficialNotices(){
      stopOfficialNotices();
      if(!currentCity||!authReady)return;
      officialRef=db.ref('officialNotices/'+currentCity.id);
      officialListener=function(s){officialData=s.val()||{};renderOfficialNotices();};
      officialRef.on('value',officialListener,function(err){console.error('Official notice read',err);});
      refreshOfficialAdmin();
    }
    function stopOfficialNotices(){
      if(officialRef&&officialListener)officialRef.off('value',officialListener);
      officialRef=null;officialListener=null;officialData={};
    }
    function refreshOfficialAdmin(){
      officialIsAdmin=false;
      var user=auth.currentUser;
      var t=officialL();
      var status=document.getElementById('profileAdminStatus');
      var login=document.getElementById('profileAdminLoginButton');
      var tools=document.getElementById('officialAdminTools');
      var reportButton=document.getElementById('adminReportsButton');
      if(status)status.textContent=t[5];
      if(login){login.classList.remove('hidden');login.textContent=t[2];}
      if(tools)tools.classList.add('hidden');
      if(reportButton)reportButton.classList.add('hidden');
      closeAdminReports();
      if(!user){renderOfficialNotices();return;}
      db.ref('officialAdmins/'+user.uid).once('value').then(function(s){
        if(auth.currentUser&&auth.currentUser.uid===user.uid){
          officialIsAdmin=s.val()===true && user.providerData.some(function(p){return p.providerId==='google.com';});
          if(status)status.textContent=officialIsAdmin?t[3]:(user.providerData.some(function(p){return p.providerId==='google.com';})?t[4]:t[5]);
          if(login)login.classList.toggle('hidden',officialIsAdmin);
          if(tools)tools.classList.toggle('hidden',!officialIsAdmin);
          if(reportButton)reportButton.classList.toggle('hidden',!officialIsAdmin);
          renderOfficialNotices();
        }
      }).catch(function(e){console.error('Admin lookup',e);renderOfficialNotices();});
    }
    function loginOfficialAdmin(){
      if(!auth.currentUser)return;
      var provider=new firebase.auth.GoogleAuthProvider();
      // Use one popup directly from the button click. Retrying a second
      // popup asynchronously after a failed linkWithPopup is blocked by
      // browser popup protection (auth/popup-blocked).
      // Existing Google admins must sign in to their established UID.
      auth.signInWithPopup(provider).then(function(result){
        return result.user.getIdToken(true).then(function(){return result.user;});
      }).then(function(signedInUser){
        myUserId=signedInUser.uid;
        refreshOfficialAdmin();
      }).catch(function(e){
        console.error('Google admin sign-in',e);
        alert('Google 로그인에 실패했습니다: '+(e.code||e.message));
      });
    }
    // The current Firebase rules prohibit extra fields. Store category in the title
    // with a stable prefix, preserving the existing database schema and old posts.
    function officialCategoryFromTitle(title){
      var m=/^\[(NOTICE|RECOMMEND|TIP)\]\s*/.exec(title||'');
      return {category:m?({NOTICE:'notice',RECOMMEND:'recommend',TIP:'tip'}[m[1]]):'notice',title:m?title.slice(m[0].length):title};
    }
    function officialCategoryTitle(category,title){
      var prefix={notice:'[NOTICE] ',recommend:'[RECOMMEND] ',tip:'[TIP] '}[category]||'[NOTICE] ';
      return prefix+title;
    }
    function officialCategoryLabel(category){
      var dict={ko:{notice:'📢 공지',recommend:'⭐ 추천',tip:'💡 팁'},en:{notice:'📢 Notice',recommend:'⭐ Recommended',tip:'💡 Tip'},ja:{notice:'📢 お知らせ',recommend:'⭐ おすすめ',tip:'💡 ヒント'},'zh-CN':{notice:'📢 公告',recommend:'⭐ 推荐',tip:'💡 提示'}};
      return (dict[currentLang]||dict.ko)[category]||dict.ko.notice;
    }
    // Structured blog blocks are encoded in the existing body string, preserving Firebase rules.
    // Legacy plain text and LT_PHOTOS_V1 posts are read without changing their stored data.
    var officialBlocks=[];
    function officialValidPhotoUrl(value){
      try{var u=new URL(value);return u.protocol==='https:'&&u.hostname==='res.cloudinary.com'&&u.pathname.indexOf('/image/upload/')!==-1&&u.href.length<=800;}catch(e){return false;}
    }
    function officialPhotoDecode(body){
      var match=/\n\[\[LT_PHOTOS_V1:([A-Za-z0-9+/=]+)\]\]$/.exec(body||'');
      if(!match)return {body:body||'',photos:[]};
      try{var urls=JSON.parse(decodeURIComponent(escape(atob(match[1]))));return {body:body.slice(0,match.index),photos:Array.isArray(urls)?urls.filter(officialValidPhotoUrl).slice(0,10):[]};}
      catch(e){return {body:body||'',photos:[]};}
    }
    function officialDecodeBlocks(body){
      var m=/^\[\[LT_BLOCKS_V1:([A-Za-z0-9+/=]+)\]\]$/.exec(body||'');
      if(m){try{
        var blocks=JSON.parse(decodeURIComponent(escape(atob(m[1]))));
        if(Array.isArray(blocks)&&blocks.length<=40&&blocks.every(function(b){return b&&((b.type==='text'&&typeof b.text==='string')||(b.type==='image'&&officialValidPhotoUrl(b.url)));}))return blocks;
      }catch(e){}}
      var old=officialPhotoDecode(body);
      var result=[];
      if(old.body)result.push({type:'text',text:old.body});
      old.photos.forEach(function(url){result.push({type:'image',url:url});});
      return result.length?result:[{type:'text',text:''}];
    }
    function officialEncodeBlocks(blocks){return '[[LT_BLOCKS_V1:'+btoa(unescape(encodeURIComponent(JSON.stringify(blocks))))+']]';}
    function officialTextBlocks(){
      document.querySelectorAll('#officialBlockList [data-block-index]').forEach(function(el){
        var idx=Number(el.dataset.blockIndex);
        if(officialBlocks[idx]&&officialBlocks[idx].type==='text')officialBlocks[idx].text=el.value;
      });
    }
    function officialBlockPhotoCount(){return officialBlocks.filter(function(b){return b.type==='image';}).length;}
    function officialRenderBlockEditor(){
      var list=document.getElementById('officialBlockList');if(!list)return;
      list.replaceChildren();
      officialBlocks.forEach(function(b,i){
        var row=document.createElement('div');row.className='rounded-xl border border-slate-200 bg-white p-2 space-y-2';
        var header=document.createElement('div');header.className='flex items-center gap-2';
        var label=document.createElement('span');label.className='text-xs font-bold text-slate-600 flex-1';label.textContent=(i+1)+'. '+(b.type==='text'?'글':'사진');header.appendChild(label);
        [['↑',-1],['↓',1],['삭제',0]].forEach(function(opt){
          var btn=document.createElement('button');btn.type='button';btn.textContent=opt[0];btn.className='border rounded-lg px-2 py-1 text-xs bg-slate-50';
          btn.disabled=(opt[1]===-1&&i===0)||(opt[1]===1&&i===officialBlocks.length-1);
          btn.addEventListener('click',function(){officialTextBlocks();if(opt[1]===0)officialBlocks.splice(i,1);else{var j=i+opt[1],tmp=officialBlocks[i];officialBlocks[i]=officialBlocks[j];officialBlocks[j]=tmp;}officialRenderBlockEditor();});header.appendChild(btn);
        });row.appendChild(header);
        if(b.type==='text'){
          var ta=document.createElement('textarea');ta.className='w-full border rounded-lg p-3 text-sm';ta.rows=3;ta.placeholder='이 위치에 표시할 설명을 작성하세요';ta.value=b.text;ta.dataset.blockIndex=i;
          ta.addEventListener('input',function(){b.text=ta.value;});row.appendChild(ta);
        }else{
          var img=document.createElement('img');img.src=b.url;img.loading='lazy';img.alt='첨부 사진';img.className='w-full rounded-lg object-contain';img.style.maxHeight='180px';row.appendChild(img);
        }
        list.appendChild(row);
      });
      var count=document.getElementById('officialPhotoCount');if(count)count.textContent=officialBlockPhotoCount()+' / 10';
    }
    function officialAddTextBlock(){officialTextBlocks();officialBlocks.push({type:'text',text:''});officialRenderBlockEditor();}
    function officialAddPhotoUrl(){
      var input=document.getElementById('officialPhotoUrl'),url=input.value.trim();
      if(!officialValidPhotoUrl(url)){alert('Cloudinary의 공개 HTTPS 이미지 URL을 입력해 주세요.');return;}
      if(officialBlockPhotoCount()>=10){alert('사진은 최대 10장까지 등록할 수 있습니다.');return;}
      if(officialBlocks.some(function(b){return b.type==='image'&&b.url===url;})){alert('이미 추가한 사진입니다.');return;}
      officialTextBlocks();officialBlocks.push({type:'image',url:url});input.value='';officialRenderBlockEditor();
    }
    function openOfficialNoticeEditor(){
      if(!officialIsAdmin)return;officialEditId=null;
      document.getElementById('officialTitle').value='';document.getElementById('officialCategory').value='notice';officialBlocks=[{type:'text',text:''}];officialRenderBlockEditor();
      document.getElementById('officialEditorHeading').textContent='공식 공지 작성';
      var editor=document.getElementById('officialEditor');document.body.appendChild(editor);editor.classList.remove('hidden');
      document.getElementById('officialTitle').focus();
    }
    function closeOfficialNoticeEditor(){
      officialEditId=null;document.getElementById('officialEditor').classList.add('hidden');
    }
    function publishOfficialNotice(){
      if(!officialIsAdmin||!currentCity||!auth.currentUser)return;
      officialTextBlocks();
      var title=document.getElementById('officialTitle').value.trim();
      var storedTitle=officialCategoryTitle(document.getElementById('officialCategory').value,title);
      var blocks=officialBlocks.filter(function(b){return b.type==='image'||b.text.trim();});
      var storedBody=officialEncodeBlocks(blocks);
      if(!title||!blocks.length||storedTitle.length>120||storedBody.length>4000){alert('제목 또는 내용이 너무 깁니다. 사진 URL을 줄이거나 본문을 짧게 작성해 주세요.');return;}
      var ref=db.ref('officialNotices/'+currentCity.id);
      var task=officialEditId?ref.child(officialEditId).update({title:storedTitle,body:storedBody}):
        ref.push().set({uid:auth.currentUser.uid,title:storedTitle,body:storedBody,createdAt:firebase.database.ServerValue.TIMESTAMP});
      task.then(function(){closeOfficialNoticeEditor();document.getElementById('officialTitle').value='';})
        .catch(function(e){console.error(e);alert(officialL()[7]);});
    }
    function editOfficialNotice(id){
      var p=officialData[id];if(!officialIsAdmin||!p)return;
      officialEditId=id;
      var parsed=officialCategoryFromTitle(p.title);
      document.getElementById('officialCategory').value=parsed.category;
      document.getElementById('officialTitle').value=parsed.title;
      officialBlocks=officialDecodeBlocks(p.body);officialRenderBlockEditor();
      document.getElementById('officialEditorHeading').textContent='공식 공지 수정';
      var editor=document.getElementById('officialEditor');document.body.appendChild(editor);editor.classList.remove('hidden');
      document.getElementById('officialTitle').focus();
    }
    function deleteOfficialNotice(id){
      if(!officialIsAdmin||!officialData[id]||!confirm(officialL()[8]))return;
      db.ref('officialNotices/'+currentCity.id+'/'+id).remove().catch(function(e){console.error(e);alert(officialL()[7]);});
    }
    function boardExpandLabel(expanded){
      var labels={
        ko:['내용보기','접기'],
        en:['View content','Collapse'],
        ja:['内容を見る','閉じる'],
        'zh-CN':['查看内容','收起']
      };
      var pair=labels[currentLang]||labels.ko;
      return pair[expanded?1:0];
    }
    var officialOpenNotices = new Set();
    var officialSearchText='';
    var officialCategoryFilter='all';
    function officialSearchCorpus(p){
      var title=officialCategoryFromTitle(p.title).title;
      var blocks=officialDecodeBlocks(p.body);
      var content=blocks.filter(function(b){return b.type==='text';}).map(function(b){return b.text;}).join(' ');
      var text=(title+' '+content).toLowerCase();
      var aliases=[['명동','myeongdong','myungdong','明洞','ミョンドン'],['홍대','hongdae','hongik','弘大','ホンデ'],['서울역','seoul station','ソウル駅'],['강남','gangnam','江南','カンナム'],['경복궁','gyeongbokgung','景福宮','景福宫'],['동대문','dongdaemun','東大門'],['부산','busan','釜山'],['해운대','haeundae','海雲台'],['제주','jeju','済州','济州']];
      aliases.forEach(function(group){if(group.some(function(word){return text.indexOf(word.toLowerCase())!==-1;}))text+=' '+group.join(' ').toLowerCase();});
      return text;
    }
    function officialSearchLabels(){
      return ({ko:['장소나 제목 검색 (예: 명동)','전체','공지','추천','팁','검색 결과가 없습니다.'],en:['Search places or titles (e.g. Myeongdong)','All','Notice','Recommended','Tip','No matching posts.'],ja:['場所・タイトルを検索','すべて','お知らせ','おすすめ','ヒント','検索結果がありません'], 'zh-CN':['搜索地点或标题','全部','公告','推荐','提示','没有搜索结果']})[currentLang]||['장소나 제목 검색 (예: 명동)','전체','공지','추천','팁','검색 결과가 없습니다.'];
    }
    function renderOfficialNotices(){
      var wrap=document.getElementById('officialPosts');if(!wrap)return;
      wrap.replaceChildren();
      var q=officialSearchText.trim().toLowerCase();
      var aliases=[['명동','myeongdong','myungdong','明洞','ミョンドン'],['홍대','hongdae','hongik','弘大','ホンデ'],['서울역','seoul station','ソウル駅'],['강남','gangnam','江南','カンナム'],['경복궁','gyeongbokgung','景福宮','景福宫'],['동대문','dongdaemun','東大門'],['부산','busan','釜山'],['해운대','haeundae','海雲台'],['제주','jeju','済州','济州']];
      var normalized=q;
      aliases.forEach(function(group){if(group.some(function(word){return word.toLowerCase()===q;}))normalized=group[0];});
      var ids=Object.keys(officialData).filter(function(id){
        var p=officialData[id];if(!p||typeof p.title!=='string'||typeof p.body!=='string')return false;
        if(officialCategoryFilter!=='all'&&officialCategoryFromTitle(p.title).category!==officialCategoryFilter)return false;
        return !q||officialSearchCorpus(p).indexOf(q)!==-1||officialSearchCorpus(p).indexOf(normalized)!==-1;
      }).sort(function(a,b){return (officialData[b].createdAt||0)-(officialData[a].createdAt||0);});
      if(boardSection==='notice')updateBoardSearchCount(ids.length);
      if(!ids.length){var empty=document.createElement('p');empty.className='text-sm text-slate-400 text-center py-8';empty.textContent=officialSearchLabels()[5];wrap.appendChild(empty);}
      ids.forEach(function(id){
        var p=officialData[id],parsed=officialCategoryFromTitle(p.title);
        var card=document.createElement('article');card.className='bg-white border border-slate-200 rounded-2xl p-3 shadow-sm';
        var details=document.createElement('details');details.className='group';
        var summary=document.createElement('summary');summary.className='cursor-pointer list-none flex items-center gap-2 text-sm';
        var tag=document.createElement('span');tag.className='shrink-0 bg-indigo-50 text-indigo-700 rounded px-2 py-1 text-xs font-bold';tag.textContent=officialCategoryLabel(parsed.category);
        var title=document.createElement('span');title.className='font-bold text-slate-800 flex-1 break-words';title.textContent=parsed.title;
        var toggle=document.createElement('span');toggle.className='text-indigo-600 font-semibold shrink-0';toggle.style.fontSize='13px';toggle.style.whiteSpace='nowrap';
        if(officialOpenNotices.has(id))details.open=true;
        toggle.textContent=boardExpandLabel(details.open);
        details.addEventListener('toggle',function(){if(details.open){officialOpenNotices.add(id);content.querySelectorAll('[data-board-translation-key]').forEach(boardTranslateElement);}else officialOpenNotices.delete(id);toggle.textContent=boardExpandLabel(details.open);});
        boardDisplayText(title,parsed.title,'official:'+id+':title');summary.appendChild(tag);summary.appendChild(title);summary.appendChild(toggle);details.appendChild(summary);
        var content=document.createElement('div');content.className='mt-3 pt-3 border-t space-y-3 text-sm text-slate-700';
        officialDecodeBlocks(p.body).forEach(function(block){
          if(block.type==='text'){
            var text=document.createElement('p');text.className='whitespace-pre-wrap break-words';text.textContent=block.text;boardDisplayText(text,block.text,'official:'+id+':block:'+content.childNodes.length,true);content.appendChild(text);
          }else{
            var img=document.createElement('img');img.src=block.url;img.alt='첨부 사진';img.loading='lazy';img.decoding='async';img.className='w-full rounded-xl object-contain cursor-pointer';
            img.addEventListener('click',function(){window.open(block.url,'_blank','noopener,noreferrer');});content.appendChild(img);
          }
        });details.appendChild(content);if(details.open)content.querySelectorAll('[data-board-translation-key]').forEach(boardTranslateElement);
        if(officialIsAdmin){var actions=document.createElement('div');actions.className='flex gap-2 mt-2';actions.appendChild(officialButton(officialL()[9],function(){editOfficialNotice(id);}));actions.appendChild(officialButton(officialL()[10],function(){deleteOfficialNotice(id);},true));details.appendChild(actions);}
        card.appendChild(details);wrap.appendChild(card);
      });
    }
    function updateOfficialSearchUI(){
      var labels=officialSearchLabels(),input=document.getElementById('officialSearchInput'),select=document.getElementById('officialSearchCategory');
      if(input)input.placeholder=labels[0];
      var communityInput=document.getElementById('communitySearchInput');if(communityInput)communityInput.placeholder=communitySearchLabels()[0];
      if(select)Array.from(select.options).forEach(function(opt,i){opt.textContent=labels[i+1];});
    }
    function officialSearchChanged(value){officialSearchText=value;renderOfficialNotices();}
    function officialFilterChanged(value){officialCategoryFilter=value;renderOfficialNotices();}
    // Official notices and tips are now created by admins in Firebase.
    // The old hardcoded demo posts are intentionally no longer rendered.
    function renderBoardPosts() {
      var container = document.getElementById('boardPosts');
      if (container) container.replaceChildren();
    }

    function openChatRoomList() {
      stopCommunityListener();
      if (!currentCity || !requireAuth()) return;
      currentView = 'roomList';

      document.getElementById('boardView').classList.add('hidden');
      document.getElementById('chatView').classList.add('hidden');
      document.getElementById('mapView').classList.add('hidden');
      document.getElementById('roomListView').classList.remove('hidden');

      var cityName = getCityName(currentCity);
      var t = I18N[currentLang] || I18N['ko'];

      document.getElementById('headerTitle').innerText = cityName + t.roomListTitle;
      document.getElementById('headerSub').innerText = uiText('roomMax');
      document.getElementById('roomListNoticeTitle').innerText = t.roomNoticeTitle;
      document.getElementById('roomListNoticeSub').innerText = t.roomNoticeSub;

      if (roomListListenerRef) roomListListenerRef.off();
      var roomsRef = db.ref('rooms/' + currentCity.id);
      roomListListenerRef = roomsRef;
      roomsRef.on('value', function(snapshot) {
        var data = snapshot.val() || {};
        roomUserCounts = {};
        for (var roomId in data) {
          if (data[roomId] && data[roomId].activeUsers) {
            roomUserCounts[roomId] = Object.keys(data[roomId].activeUsers).length;
          }
        }
        renderChatRooms();
      });
    }

    function renderChatRooms() {
      var container = document.getElementById('chatRoomsContainer');
      container.innerHTML = '';
      var t = I18N[currentLang] || I18N['ko'];

      for (var rId = 1; rId <= 5; rId++) {
        var count = roomUserCounts[rId] || 0;
        var max = 4;
        var isFull = count >= max;

        var statusBadge = isFull 
          ? '<span class="text-xs bg-rose-50 text-rose-600 font-bold px-2.5 py-0.5 rounded-full border border-rose-100">' + count + '/' + max + ' ' + t.roomFull + '</span>'
          : '<span class="text-xs bg-emerald-50 text-emerald-600 font-bold px-2.5 py-0.5 rounded-full border border-emerald-100">' + count + '/' + max + uiText('roomOccupancy') + '</span>';

        var btnHtml = isFull
          ? '<button disabled class="bg-slate-200 text-slate-400 px-4 py-2 rounded-xl font-bold text-xs cursor-not-allowed">' + uiText('roomFullShort') + '</button>'
          : '<button onclick="enterSpecificChatRoom(' + rId + ')" class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl font-bold text-xs transition shadow-sm">' + t.roomEnter + '</button>';

        var card = '<div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex justify-between items-center w-full min-w-0">' +
          '<div class="flex items-center gap-3 min-w-0 flex-1 pr-2">' +
            '<div class="w-9 h-9 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-sm shrink-0"><i class="fas fa-hashtag"></i></div>' +
            '<div class="min-w-0 flex-1">' +
              '<h4 class="font-extrabold text-slate-900 text-base leading-tight">Room #' + rId + '</h4>' +
              '<div class="mt-1">' + statusBadge + '</div>' +
            '</div>' +
          '</div>' +
          btnHtml +
        '</div>';

        container.innerHTML += card;
      }
    }

    function enterSpecificChatRoom(roomId) {
      if (!requireAuth()) return;
      if (!userCountry || !userNickname) {
        openProfileModal();
        return;
      }

      // UI-only capacity checks are not authoritative; use Firebase rules and
      // a transactional server-side admission design before public launch.
      if ((roomUserCounts[roomId] || 0) >= 4) {
        alert(uiText('roomFullAlert'));
        return;
      }
      stopRoomListeners();
      if (currentRoomUsersRef) {
        leaveCurrentRoom();
      }
      if (roomListListenerRef) { roomListListenerRef.off(); roomListListenerRef = null; }

      currentRoom = roomId;
      roomJoinToken++;
      roomPreviousUsers = null;
      roomNoticeQueue = [];
      roomLatestMessages = [];
      roomEntryMessageKeys = new Set();
      roomHistoryReady = false;
      roomAdmissionReady = false;
      currentView = 'chat';

      var flagOnly = userCountry.split(' ')[0];
      var myDisplayName = flagOnly + ' ' + userNickname;

      currentRoomUsersRef = db.ref('rooms/' + currentCity.id + '/' + roomId + '/activeUsers/' + myUserId);
      var joiningRef = currentRoomUsersRef;
      var joinToken = roomJoinToken;
      // An immediate re-entry must not race a preceding exit's Firebase removal.
      roomLeaveInFlight.then(function() {
        if (joinToken !== roomJoinToken) return null;
        // Register server disconnect cleanup BEFORE announcing presence.
        return joiningRef.onDisconnect().remove();
      }).then(function() {
        if (joinToken !== roomJoinToken) return null;
        // Capture all messages already present BEFORE publishing our presence.
        // This is a display filter, NOT an authorization or privacy boundary.
        return joiningRef.parent.parent.child('messages').once('value');
      }).then(function(snapshot) {
        if (joinToken !== roomJoinToken || !snapshot) return;
        roomEntryMessageKeys = new Set(Object.keys(snapshot.val() || {}));
        roomHistoryReady = true;
        renderMessages(roomLatestMessages);
        // Best-effort cleanup only if room was empty before our entry.
        return joiningRef.parent.once('value').then(function(users) {
          if (!users.exists()) return joiningRef.parent.parent.child('messages').remove();
        });
      }).then(function() {
        if (joinToken !== roomJoinToken) return;
        return joiningRef.set({ name: myDisplayName, joinedAt: firebase.database.ServerValue.TIMESTAMP });
      }).then(function() {
        if (joinToken === roomJoinToken) {
          roomAdmissionReady = true;
          watchRoomConnection(joiningRef, joinToken, myDisplayName);
        }
      }).catch(function(err) {
        console.error('Room admission failed:', err);
        alert(uiText('roomJoinFailed'));
        goBackFromFailedAdmission();
      });

      document.getElementById('roomListView').classList.add('hidden');
      document.getElementById('mapView').classList.add('hidden');
      document.getElementById('chatView').classList.remove('hidden');
      document.getElementById('chatView').classList.add('flex');

      var cityName = getCityName(currentCity);
      var t = I18N[currentLang] || I18N['ko'];

      document.getElementById('headerTitle').innerText = cityName + ' Room #' + roomId;
      document.getElementById('chatNoticeTitle').innerText = cityName + ' Room #' + roomId + ' Q&A';
      document.getElementById('chatNoticeSub').innerText = t.noticeSub;

      listenRoomPresence();
      listenRealtimeMessages();
    }

    // Firebase onDisconnect registrations are one-shot. After a WebView is
    // suspended and its connection drops, re-arm cleanup and restore only
    // this user's missing presence, without clearing message history.
    function watchRoomConnection(joiningRef, joinToken, displayName) {
      if (roomConnectionRef && roomConnectionCallback) {
        roomConnectionRef.off('value', roomConnectionCallback);
      }
      roomConnectionRef = db.ref('.info/connected');
      roomConnectionCallback = function(snapshot) {
        if (joinToken !== roomJoinToken || currentRoomUsersRef !== joiningRef) return;
        if (snapshot.val() !== true) {
          roomAdmissionReady = false;
          return;
        }
        if (roomReconnectBusy) return;
        roomReconnectBusy = true;
        joiningRef.onDisconnect().remove().then(function() {
          if (joinToken !== roomJoinToken || currentRoomUsersRef !== joiningRef) return;
          return joiningRef.once('value').then(function(userSnapshot) {
            if (joinToken !== roomJoinToken || currentRoomUsersRef !== joiningRef) return;
            if (!userSnapshot.exists()) {
              return joiningRef.set({
                name: displayName,
                joinedAt: firebase.database.ServerValue.TIMESTAMP
              });
            }
          });
        }).then(function() {
          if (joinToken === roomJoinToken && currentRoomUsersRef === joiningRef) {
            roomAdmissionReady = true;
          }
        }).catch(function(error) {
          console.error('Room reconnect failed:', error);
          roomAdmissionReady = false;
        }).then(function() { roomReconnectBusy = false; });
      };
      roomConnectionRef.on('value', roomConnectionCallback);
    }

    function goBackFromFailedAdmission() {
      stopRoomListeners();
      roomAdmissionReady = false;
      currentRoomUsersRef = null;
      document.getElementById('chatView').classList.add('hidden');
      document.getElementById('chatView').classList.remove('flex');
      openChatRoomList();
    }

    function stopRoomListeners() {
      clearPendingRoomLeaves();
      if (roomConnectionRef && roomConnectionCallback) {
        roomConnectionRef.off('value', roomConnectionCallback);
      }
      roomConnectionRef = null;
      roomConnectionCallback = null;
      roomReconnectBusy = false;
      roomAdmissionReady = false;
      roomJoinToken++;
      roomPreviousUsers = null;
      roomNoticeQueue = [];
      roomLatestMessages = [];
      roomEntryMessageKeys = new Set();
      roomHistoryReady = false;
      if (roomPresenceListener) roomPresenceListener.off();
      if (messageListenerRef) messageListenerRef.off();
      roomPresenceListener = null;
      messageListenerRef = null;
    }

    // Connection loss can remove presence without an intentional exit.
    // Explicit exits use joinedAt=0 to display a notice immediately; brief
    // disconnections get a short grace period to avoid phantom departures.
    var pendingRoomLeaves = Object.create(null);
    var ROOM_LEAVE_NOTICE_GRACE_MS = 5000;
    function clearPendingRoomLeaves() {
      Object.keys(pendingRoomLeaves).forEach(function(uid) {
        clearTimeout(pendingRoomLeaves[uid].timer);
        delete pendingRoomLeaves[uid];
      });
    }

    function listenRoomPresence() {
      if (roomPresenceListener) roomPresenceListener.off();

      var roomRef = db.ref('rooms/' + currentCity.id + '/' + currentRoom);
      roomPresenceListener = roomRef.child('activeUsers');

      roomPresenceListener.on('value', function(snapshot) {
        var snapshotUsers = snapshot.val() || {};
        var usersData = {};
        Object.keys(snapshotUsers).forEach(function(uid) {
          var member = snapshotUsers[uid];
          // joinedAt=0 is a temporary, rules-compatible explicit-exit signal.
          if (member && member.joinedAt !== 0) usersData[uid] = member;
        });
        var userCount = Object.keys(usersData).length;
        // Only transitions after the initial presence snapshot generate notices.
        // Keep a position in the message timeline, not a permanent footer.
        if (roomPreviousUsers !== null && roomHistoryReady) {
          var visibleCount = roomLatestMessages.filter(function(m) {
            return m && !roomEntryMessageKeys.has(m.id);
          }).length;
          Object.keys(usersData).forEach(function(uid) {
            if (uid === myUserId) return;
            if (pendingRoomLeaves[uid]) {
              // Same participant reconnected before the departure notice.
              clearTimeout(pendingRoomLeaves[uid].timer);
              delete pendingRoomLeaves[uid];
              return;
            }
            if (!Object.prototype.hasOwnProperty.call(roomPreviousUsers, uid)) {
              roomNoticeQueue.push({ id: ++roomNoticeSeq, position: visibleCount, kind: 'join', actor: String(usersData[uid].name || uiText('participant')) });
            }
          });
          Object.keys(roomPreviousUsers).forEach(function(uid) {
            if (uid === myUserId || Object.prototype.hasOwnProperty.call(usersData, uid)) return;
            var actor = String(roomPreviousUsers[uid].name || uiText('participant'));
            // Unlike network loss, an explicit exit should display at once.
            if (snapshotUsers[uid] && snapshotUsers[uid].joinedAt === 0) {
              if (pendingRoomLeaves[uid]) {
                clearTimeout(pendingRoomLeaves[uid].timer);
                delete pendingRoomLeaves[uid];
              }
              roomNoticeQueue.push({ id: ++roomNoticeSeq, position: visibleCount, kind: 'leave', actor: actor });
              return;
            }
            if (pendingRoomLeaves[uid]) return;
            var noticeToken = roomJoinToken;
            var pending = { timer: null };
            pendingRoomLeaves[uid] = pending;
            pending.timer = setTimeout(function() {
              if (pendingRoomLeaves[uid] !== pending || roomJoinToken !== noticeToken || currentView !== 'chat') return;
              delete pendingRoomLeaves[uid];
              // A later snapshot may already show the participant again.
              if (roomPreviousUsers && Object.prototype.hasOwnProperty.call(roomPreviousUsers, uid)) return;
              var at = roomLatestMessages.filter(function(m) { return m && !roomEntryMessageKeys.has(m.id); }).length;
              roomNoticeQueue.push({ id: ++roomNoticeSeq, position: at, kind: 'leave', actor: actor });
              if (roomNoticeQueue.length > 30) roomNoticeQueue.splice(0, roomNoticeQueue.length - 30);
              renderMessages(roomLatestMessages || []);
            }, ROOM_LEAVE_NOTICE_GRACE_MS);
          });
          if (roomNoticeQueue.length > 30) roomNoticeQueue.splice(0, roomNoticeQueue.length - 30);
          if (currentView === 'chat') renderMessages(roomLatestMessages || []);
        }
        roomPreviousUsers = usersData;
        
        var cityName = getCityName(currentCity);
        document.getElementById('headerSub').innerText = uiText('nowOnline', userCount);

        // Do not delete all messages from a presence callback. A trusted
        // backend retention job should handle any intended expiry policy.
      });
    }

    function listenRealtimeMessages() {
      if (messageListenerRef) messageListenerRef.off();
      var msgsRef = db.ref('rooms/' + currentCity.id + '/' + currentRoom + '/messages');
      messageListenerRef = msgsRef;
      msgsRef.on('value', function(snapshot) {
        var data = snapshot.val() || {};
        var msgList = [];
        for (var k in data) {
          if (data[k] && typeof data[k] === 'object') {
            msgList.push(Object.assign({}, data[k], { id: k }));
          }
        }
        roomLatestMessages = msgList;
        renderMessages(msgList);
      });
    }

    function renderGoogleMap() {
      if (typeof google === 'undefined' || !google.maps) {
        loadGoogleMapsScript(currentLang, renderGoogleMap);
        return;
      }

      var centerLat = currentCity ? currentCity.lat : (userLatLng ? userLatLng.lat : 36.3);
      var centerLng = currentCity ? currentCity.lng : (userLatLng ? userLatLng.lng : 127.8);
      var zoomLevel = currentCity ? 12 : (userLatLng ? 14 : 7);
      var t = I18N[currentLang] || I18N['ko'];

      var mapOptions = {
        center: { lat: centerLat, lng: centerLng },
        zoom: zoomLevel,
        mapTypeControl: false,
        streetViewControl: false
      };

      googleMapInstance = new google.maps.Map(document.getElementById("googleMap"), mapOptions);
      googleMapMarkers = [];
      updateMyLocationLabels();

      for (var j = 0; j < CITIES.length; j++) {
        var c = CITIES[j];
        var cName = getCityName(c);

        var marker = new google.maps.Marker({
          position: { lat: c.lat, lng: c.lng },
          map: googleMapInstance,
          title: cName
        });

        var infowindow = new google.maps.InfoWindow({
          content: '<div style="padding:6px; font-size:12px; font-weight:bold; text-align:center;">' +
            cName + '<br><span style="font-size:11px; color:#4f46e5; cursor:pointer;" onclick="openCityBoard(\'' + c.id + '\')">' + t.mapQaLink + '</span>' +
          '</div>'
        });

        (function(m, iw) {
          m.addListener("click", function() {
            iw.open(googleMapInstance, m);
          });
        })(marker, infowindow);

        googleMapMarkers.push(marker);
      }

      // Do not request GPS merely because the user opened the map.
      // Only the explicit 'my location' button should prompt for permission.
      if (userLatLng) drawMyLocationMarker(false);
      var mapStatus = document.getElementById('mapGeoStatus');
      if (mapStatus) mapStatus.classList.add('hidden');
    }

    function searchGoogleMapLocation() {
      var query = document.getElementById('mapSearchInput').value.trim();
      if (!query || !googleMapInstance) return;

      for (var i = 0; i < searchMarkers.length; i++) {
        searchMarkers[i].setMap(null);
      }
      searchMarkers = [];

      var targetText = query;
      if (query === "현대") targetText = "더현대 대구";

      var geocoder = new google.maps.Geocoder();
      var geocodeOptions = { address: targetText };
      if (userLatLng) geocodeOptions.location = userLatLng;

      geocoder.geocode(geocodeOptions, function(results, status) {
        if (status === "OK" && results[0]) {
          var loc = results[0].geometry.location;
          var placeName = results[0].formatted_address || targetText;

          googleMapInstance.setCenter(loc);
          googleMapInstance.setZoom(16);

          var sMarker = new google.maps.Marker({
            map: googleMapInstance,
            position: loc,
            title: placeName,
            animation: google.maps.Animation.DROP
          });

          var encodedQuery = encodeURIComponent(targetText);
          var naverMapUrl = "https://m.map.naver.com/search2/search.naver?query=" + encodedQuery;
          var kakaoMapUrl = "https://m.map.kakao.com/actions/searchView?q=" + encodedQuery;

          var windowContent = '<div style="padding:8px; font-size:13px; font-family:sans-serif; max-width:220px;">' +
            '<strong style="color:#1e293b; font-size:14px; display:block; margin-bottom:4px;">📍 ' + targetText + '</strong>' +
            '<span style="color:#64748b; font-size:11px; display:block; margin-bottom:8px; line-height:1.2;">' + placeName + '</span>' +
            '<div style="display:flex; flex-direction:column; gap:6px;">' +
              '<a href="' + naverMapUrl + '" target="_blank" style="text-align:center; background:#03C75A; color:white; text-decoration:none; padding:8px; border-radius:8px; font-size:12px; font-weight:bold; display:block;">' +
                uiText('naverDirections') +
              '</a>' +
              '<a href="' + kakaoMapUrl + '" target="_blank" style="text-align:center; background:#FEE500; color:#191919; text-decoration:none; padding:8px; border-radius:8px; font-size:12px; font-weight:bold; display:block;">' +
                uiText('kakaoDirections') +
              '</a>' +
            '</div>' +
          '</div>';

          var sInfoWindow = new google.maps.InfoWindow({
            content: windowContent
          });

          sMarker.addListener("click", function() {
            sInfoWindow.open(googleMapInstance, sMarker);
          });

          sInfoWindow.open(googleMapInstance, sMarker);
          searchMarkers.push(sMarker);
        } else {
          alert(uiText('mapNoPlace'));
        }
      });
    }

    function drawMyLocationMarker(panToUser) {
      if (!userLatLng || !googleMapInstance || typeof google === 'undefined' || !google.maps) return;
      if (myLocationInfoWindow) { myLocationInfoWindow.close(); myLocationInfoWindow = null; }
      if (myLocationMarker) myLocationMarker.setMap(null);
      myLocationMarker = new google.maps.Marker({
        position: userLatLng,
        map: googleMapInstance,
        title: myLocationName(),
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: '#ef4444',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2
        }
      });
      // A clearly visible rectangular name card anchored to the GPS dot.
      // We pass a text node rather than interpolating HTML.
      var popupText = document.createElement('span');
      popupText.textContent = '📍 ' + myLocationName();
      popupText.style.fontSize = '13px';
      popupText.style.fontWeight = '700';
      popupText.style.whiteSpace = 'nowrap';
      myLocationInfoWindow = new google.maps.InfoWindow({
        content: popupText,
        disableAutoPan: true
      });
      myLocationInfoWindow.open(googleMapInstance, myLocationMarker);
      myLocationMarker.addListener('click', function() {
        if (myLocationInfoWindow) myLocationInfoWindow.open(googleMapInstance, myLocationMarker);
      });
      if (panToUser) {
        googleMapInstance.setCenter(userLatLng);
        googleMapInstance.setZoom(14);
      }
    }

    function moveToMyLocation(shouldPan) {
      // Called by a deliberate click on the map's crosshair button.
      if (mapLocationRequestBusy) return;
      if (!navigator.geolocation) { showMapLocationStatus('unsupported'); return; }
      if (window.isSecureContext === false) { showMapLocationStatus('insecure'); return; }

      var panToUser = shouldPan !== false;
      var button = document.getElementById('mapGeoButton');
      mapLocationRequestBusy = true;
      if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
      showMapLocationStatus('checking');
      function finish() {
        mapLocationRequestBusy = false;
        if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
      }
      navigator.geolocation.getCurrentPosition(function(position) {
        finish();
        var lat = Number(position.coords.latitude), lng = Number(position.coords.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
          if (currentView === 'map') showMapLocationStatus('unavailable');
          return;
        }
        // Coordinates stay in memory; no Firebase write or analytics event.
        userLatLng = { lat: lat, lng: lng };
        if (currentView === 'map') {
          drawMyLocationMarker(panToUser);
          showMapLocationStatus('success');
        }
      }, function(error) {
        finish();
        if (currentView !== 'map') return;
        showMapLocationStatus(error && error.code === 1 ? 'denied' : error && error.code === 3 ? 'timeout' : 'unavailable');
        console.warn('Map geolocation failed:', error && error.code);
      }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
    }

    function leaveCurrentRoom() {
      if (!currentRoomUsersRef) return roomLeaveInFlight;
      var leavingRef = currentRoomUsersRef;
      currentRoomUsersRef = null;
      // Firebase rules permit numeric joinedAt. Signal an intentional exit
      // before removing presence so observers can distinguish it from a
      // momentary WebView/network disconnect without changing database rules.
      roomLeaveInFlight = leavingRef.child('joinedAt').set(0).catch(function(error) {
        // If admission was canceled before presence was written, the marker
        // may be denied; still attempt to remove any remaining presence.
        console.warn('Room exit signal unavailable:', error);
      }).then(function() {
        return leavingRef.remove();
      }).then(function() {
        // Cancel the old onDisconnect before any new admission may begin.
        return leavingRef.onDisconnect().cancel();
      }).then(function() {
        return leavingRef.parent.once('value');
      }).then(function(snapshot) {
        if (!snapshot.exists()) {
          return leavingRef.parent.parent.child('messages').remove();
        }
      }).catch(function(error) {
        console.error('퇴장/기록 정리 실패:', error);
      });
      return roomLeaveInFlight;
    }

    function goBack() {
      if (currentView === 'chat') {
        var leaveConfirm = confirm(uiText('leaveConfirm'));
        if (!leaveConfirm) return;

        stopRoomListeners();
        leaveCurrentRoom();
        currentRoom = null;
        openChatRoomList();
      } else if (currentView === 'roomList') {
        if (roomListListenerRef) { roomListListenerRef.off(); roomListListenerRef = null; }
        openCityBoard(currentCity.id);
      } else {
        stopRoomListeners();
        if (roomListListenerRef) { roomListListenerRef.off(); roomListListenerRef = null; }
        if (currentRoomUsersRef) leaveCurrentRoom();
        if (cityPresenceRef) { cityPresenceRef.remove(); cityPresenceRef = null; }
        stopOfficialNotices();
        currentCity = null;
        currentRoom = null;
        currentView = 'home';

        document.getElementById('homeView').classList.remove('hidden');
        document.getElementById('boardView').classList.add('hidden');
        document.getElementById('roomListView').classList.add('hidden');
        document.getElementById('chatView').classList.add('hidden');
        document.getElementById('mapView').classList.add('hidden');
        document.getElementById('chatView').classList.remove('flex');
        
        document.getElementById('backBtn').classList.add('hidden');

        var t = I18N[currentLang] || I18N['ko'];
        
        document.getElementById('headerTitle').innerHTML = '<span class="home-brand">Korea<span>Local Talk</span></span>';
        document.getElementById('headerSub').innerText = t.appSub;
      }
    }

    function switchTab(tabName) {
      var tHome = document.getElementById('tabHome');
      var tMap = document.getElementById('tabMap');
      var tMy = document.getElementById('tabMy');

      tHome.className = "flex flex-col items-center gap-0.5 text-slate-400 font-medium hover:text-indigo-600 transition";
      tMap.className = "flex flex-col items-center gap-0.5 text-slate-400 font-medium hover:text-indigo-600 transition";
      tMy.className = "flex flex-col items-center gap-0.5 text-slate-400 font-medium hover:text-indigo-600 transition";

      if (tabName === 'home') {
        tHome.className = "flex flex-col items-center gap-0.5 text-indigo-600 font-bold transition";
        goBack();
      } else if (tabName === 'map') {
        tMap.className = "flex flex-col items-center gap-0.5 text-indigo-600 font-bold transition";
        if (currentRoomUsersRef) {
          stopRoomListeners();
          leaveCurrentRoom();
          currentRoom = null;
        }
        if (roomListListenerRef) { roomListListenerRef.off(); roomListListenerRef = null; }
        currentView = 'map';

        document.getElementById('homeView').classList.add('hidden');
        document.getElementById('boardView').classList.add('hidden');
        document.getElementById('roomListView').classList.add('hidden');
        document.getElementById('chatView').classList.add('hidden');
        document.getElementById('mapView').classList.remove('hidden');

        document.getElementById('backBtn').classList.remove('hidden');

        var t = I18N[currentLang] || I18N['ko'];
        document.getElementById('headerTitle').innerText = t.mapTitle;
        document.getElementById('headerSub').innerText = t.mapSub;

        loadGoogleMapsScript(currentLang, renderGoogleMap);
      } else if (tabName === 'my') {
        tMy.className = "flex flex-col items-center gap-0.5 text-indigo-600 font-bold transition";
        openProfileModal();
      }
    }

    // v7: Existing RTDB schema remains unchanged. A place is encoded in the
    // existing text field, so the published v5 security rules continue to work.
    var PLACE_PREFIX = '[LocalTalkPlace:v1]';
    var shareMap = null, shareMarker = null, selectedSharePlace = null;
    var shareGeocoder = null;
    function parseSharedPlace(text) {
      if (typeof text !== 'string' || text.indexOf(PLACE_PREFIX) !== 0) return null;
      try {
        var p = JSON.parse(text.slice(PLACE_PREFIX.length));
        if (!p || typeof p.name !== 'string' || typeof p.address !== 'string' ||
            !Number.isFinite(p.lat) || !Number.isFinite(p.lng) ||
            Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180 ||
            p.name.length > 150 || p.address.length > 350) return null;
        return p;
      } catch (e) { return null; }
    }
    var placePickerMode="chat";
    function openPlacePicker() {
      placePickerMode="chat";
      document.querySelector('#placePicker strong').textContent=(I18N[currentLang]||I18N.ko).placeTitle;
      document.getElementById("confirmSharePlace").textContent=(I18N[currentLang]||I18N.ko).placeShare;
      if (!requireAuth() || !currentCity || !currentRoom || !roomAdmissionReady) {
        alert(uiText('placeRequiresRoom')); return;
      }
      selectedSharePlace = null;
      document.getElementById('selectedPlaceLabel').textContent = uiText('placeEmpty');
      document.getElementById('confirmSharePlace').disabled = true;
      document.getElementById('placePicker').classList.remove('hidden');
      if (typeof google === 'undefined' || !google.maps) {
        loadGoogleMapsScript(currentLang, initSharePlaceMap);
      } else initSharePlaceMap();
    }
    function closePlacePicker() {
      document.getElementById('placePicker').classList.add('hidden');
    }
    function initSharePlaceMap() {
      if (document.getElementById('placePicker').classList.contains('hidden')) return;
      if (!window.google || !google.maps){
        document.getElementById('selectedPlaceLabel').textContent='지도를 불러오지 못했습니다. Google Maps API 설정과 연결 상태를 확인해 주세요.';return;
      }
      var center = userLatLng || (currentCity && currentCity.lat && currentCity.lng ? {lat:currentCity.lat,lng:currentCity.lng} : {lat:37.5665,lng:126.9780});
      shareMap = new google.maps.Map(document.getElementById('sharePlaceMap'), {center:center,zoom:13,streetViewControl:false,mapTypeControl:false});
      shareGeocoder = new google.maps.Geocoder();
      shareMap.addListener('click',function(event) {
        var lat = event.latLng.lat(), lng = event.latLng.lng();
        shareGeocoder.geocode({location:{lat:lat,lng:lng}},function(results,status) {
          if (document.getElementById('placePicker').classList.contains('hidden')) return;
          var label = status === 'OK' && results[0] ? results[0].formatted_address : lat.toFixed(5)+', '+lng.toFixed(5);
          selectSharePlace(label,label,lat,lng);
        });
      });
    }
    function selectSharePlace(name,address,lat,lng) {
      selectedSharePlace = {name:String(name).slice(0,150),address:String(address).slice(0,350),lat:lat,lng:lng};
      if (shareMarker) shareMarker.setMap(null);
      shareMarker = new google.maps.Marker({map:shareMap,position:{lat:lat,lng:lng}});
      shareMap.panTo({lat:lat,lng:lng});
      document.getElementById('selectedPlaceLabel').textContent = (I18N[currentLang] || I18N.ko).selected + selectedSharePlace.name;
      document.getElementById('confirmSharePlace').disabled = false;
    }
    function searchSharePlace() {
      var query = document.getElementById('placeSearchInput').value.trim();
      if (!query || !shareGeocoder) return;
      shareGeocoder.geocode({address:query},function(results,status) {
        if (document.getElementById('placePicker').classList.contains('hidden')) return;
        if (status !== 'OK' || !results[0]) { alert(uiText('placeNotFound')); return; }
        var r = results[0], lat=r.geometry.location.lat(), lng=r.geometry.location.lng();
        selectSharePlace(query,r.formatted_address || query,lat,lng);
        shareMap.setZoom(16);
      });
    }
    function sendSharedPlace() {
      if(placePickerMode==='board'){
        if(!selectedSharePlace||!Number.isFinite(selectedSharePlace.lat)||!Number.isFinite(selectedSharePlace.lng))return;
        communitySelectedPlace=Object.assign({},selectedSharePlace);
        document.getElementById('communityPlaceQuery').value=communitySelectedPlace.name;
        document.getElementById('communityPlaceResult').textContent='📍 '+communitySelectedPlace.name+' ('+communitySelectedPlace.lat.toFixed(5)+', '+communitySelectedPlace.lng.toFixed(5)+')';
        document.getElementById('communityPlaceRemove').classList.remove('hidden');
        closePlacePicker();return;
      }
      if (!selectedSharePlace || !roomAdmissionReady || !currentRoom || !currentCity) return;
      var payload = PLACE_PREFIX + JSON.stringify(selectedSharePlace);
      if (payload.length > 2000) { alert(uiText('placeTooLong')); return; }
      sendChatText(payload);
      closePlacePicker();
    }
    function renderPlaceCard(bubble,place,mine) {
      bubble.className += ' min-w-[210px]';
      var heading=document.createElement('div');
      heading.className='font-bold text-sm mb-1';
      heading.textContent='📍 '+place.name;
      var address=document.createElement('div');
      address.className='text-xs opacity-80 break-words mb-2';
      address.textContent=place.address;
      var button=document.createElement('button');
      button.type='button';
      button.className='block w-full text-center rounded-lg px-3 py-3 text-xs font-bold '+
        (mine?'bg-white text-indigo-700':'bg-indigo-600 text-white');
      button.textContent=currentLang==='ko'?'지도에서 위치 보기':'View on map';
      button.addEventListener('click',function(){viewPlaceInsideApp(place);});
      bubble.append(heading,address,button);
    }

    // Translation is display-only. It never writes to Firebase or modifies a message.
    // This endpoint is unofficial and may be unavailable, throttled, or blocked by CORS.
    function translationKey(msgId, text, lang) {
      return JSON.stringify([translationRoomKey, String(msgId), String(text), lang]);
    }
    function resetTranslationRoom() {
      var key = currentCity && currentRoom ? currentCity.id + '/' + currentRoom : '';
      if (key !== translationRoomKey) {
        translationRoomKey = key;
        translationEpoch++;
        translationPending.clear();
      }
    }
    function setAutoTranslate(enabled) {
      autoTranslateEnabled = !!enabled;
      localStorage.setItem('localtalk_auto_translate', enabled ? 'on' : 'off');
      renderMessages(roomLatestMessages || []);
    }
    function getTranslationControls() {
      var parent = document.getElementById('chatNoticeSub');
      if (!parent) return;
      var control = document.getElementById('autoTranslationControl');
      if (!control) {
        control = document.createElement('label');
        control.id = 'autoTranslationControl';
        control.className = 'flex items-center gap-1.5 mt-2 text-xs font-semibold text-indigo-700 cursor-pointer';
        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = 'autoTranslationCheckbox';
        checkbox.addEventListener('change', function() { setAutoTranslate(this.checked); });
        var title = document.createElement('span');
        title.id = 'autoTranslationLabel';
        control.append(checkbox, title);
        parent.insertAdjacentElement('afterend', control);
      }
      document.getElementById('autoTranslationCheckbox').checked = autoTranslateEnabled;
      document.getElementById('autoTranslationLabel').textContent =
        (I18N[currentLang] || I18N.ko).translateAuto;
    }
    function translateMsg(msgId, text, targetLang, force) {
      var lang = targetLang || currentLang;
      var key = translationKey(msgId, text, lang);
      if (!force && translationCache.has(key)) return Promise.resolve(translationCache.get(key));
      if (translationPending.has(key)) return translationPending.get(key);
      var url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' +
        encodeURIComponent(lang) + '&dt=t&q=' + encodeURIComponent(text);
      var request = fetch(url).then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function(data) {
        if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error('Invalid translation response');
        var translated = data[0].map(function(part) { return part && part[0] || ''; }).join('').trim();
        if (!translated) throw new Error('Empty translation');
        translationCache.set(key, translated);
        if (translationCache.size > TRANSLATION_CACHE_LIMIT) {
          translationCache.delete(translationCache.keys().next().value);
        }
        return translated;
      }).finally(function() { translationPending.delete(key); });
      translationPending.set(key, request);
      return request;
    }
    function renderTranslation(m, target, button, mine) {
      var text = String(m.text || '');
      var lang = currentLang;
      var key = translationKey(m.id, text, lang);
      var epoch = translationEpoch;
      var roomKey = translationRoomKey;
      function showResult(result) {
        if (epoch !== translationEpoch || roomKey !== translationRoomKey || !target.isConnected || currentLang !== lang) return;
        target.textContent = '🌐 ' + result;
        target.classList.remove('hidden');
        button.textContent = (I18N[currentLang] || I18N.ko).again;
        button.disabled = false;
      }
      function run(force) {
        button.disabled = true;
        button.textContent = (I18N[currentLang] || I18N.ko).translating;
        translateMsg(m.id, text, lang, force).then(showResult).catch(function(err) {
          console.warn('Translation unavailable:', err);
          if (epoch !== translationEpoch || !target.isConnected) return;
          target.textContent = (I18N[currentLang] || I18N.ko).failed;
          target.classList.remove('hidden');
          button.disabled = false;
          button.textContent = (I18N[currentLang] || I18N.ko).retry;
        });
      }
      button.addEventListener('click', function() { run(true); });
      if (translationCache.has(key)) showResult(translationCache.get(key));
      else if (!mine && autoTranslateEnabled && text) run(false);
    }


    // v14: local-only blocking and append-only reporting.
    // Blocking is a display filter, NOT a Firebase authorization rule.
    var safetySelectedMessage = null;
    var safetyBlocked = new Set();
    var safetyCopy = {
      ko:{title:'사용자 관리',reason:'신고 사유',info:'차단은 이 브라우저에서만 메시지를 숨깁니다. 신고 내용은 운영자 검토용으로 저장됩니다.',block:'사용자 차단',unblock:'차단 해제',report:'이 메시지 신고',close:'닫기',menu:'신고·차단',blocked:'차단한 사용자의 메시지',success:'신고가 접수되었습니다.',error:'신고 전송에 실패했습니다.',self:'본인 메시지는 신고할 수 없습니다.',reasons:['괴롭힘·욕설','스팸·광고','부적절한 내용','기타']},
      en:{title:'User safety',reason:'Report reason',info:'Blocking hides messages only in this browser. Reports are saved for operator review.',block:'Block user',unblock:'Unblock user',report:'Report this message',close:'Close',menu:'Report / block',blocked:'Message from blocked user',success:'Report submitted.',error:'Could not submit report.',self:'You cannot report your own message.',reasons:['Harassment or abuse','Spam or advertising','Inappropriate content','Other']},
      ja:{title:'ユーザー管理',reason:'通報理由',info:'ブロックはこのブラウザーでのみメッセージを非表示にします。通報は運営者の確認用に保存されます。',block:'ブロック',unblock:'ブロック解除',report:'このメッセージを通報',close:'閉じる',menu:'通報・ブロック',blocked:'ブロックしたユーザーのメッセージ',success:'通報を送信しました。',error:'通報に失敗しました。',self:'自分のメッセージは通報できません。',reasons:['嫌がらせ・暴言','スパム・広告','不適切な内容','その他']},
      'zh-CN':{title:'用户管理',reason:'举报原因',info:'屏蔽仅在此浏览器隐藏消息。举报将保存供管理员审核。',block:'屏蔽用户',unblock:'取消屏蔽',report:'举报此消息',close:'关闭',menu:'举报/屏蔽',blocked:'已屏蔽用户的消息',success:'举报已提交。',error:'举报失败。',self:'不能举报自己的消息。',reasons:['骚扰或辱骂','垃圾信息或广告','不当内容','其他']}
    };
    var blockedManagerCopy = {
      ko:{title:'차단 사용자 관리',info:'차단한 사용자의 메시지는 아무 표시 없이 숨겨집니다. 차단 목록은 이 브라우저에만 저장됩니다.',empty:'차단한 사용자가 없습니다.',unblock:'차단 해제',close:'닫기',unknown:'이름을 알 수 없는 사용자'},
      en:{title:'Blocked users',info:'Blocked users’ messages are hidden completely. Your block list is stored only in this browser.',empty:'No blocked users.',unblock:'Unblock',close:'Close',unknown:'Unknown user'},
      ja:{title:'ブロックしたユーザー',info:'ブロックしたユーザーのメッセージは完全に非表示になります。ブロック一覧はこのブラウザーにのみ保存されます。',empty:'ブロックしたユーザーはいません。',unblock:'ブロック解除',close:'閉じる',unknown:'名前不明のユーザー'},
      'zh-CN':{title:'已屏蔽用户',info:'已屏蔽用户的消息将完全隐藏。屏蔽列表仅保存在本浏览器中。',empty:'没有已屏蔽用户。',unblock:'取消屏蔽',close:'关闭',unknown:'未知用户'}
    };
    function blockedManagerText() { return blockedManagerCopy[currentLang] || blockedManagerCopy.ko; }
    function refreshBlockedManagerLabels() {
      var el=document.getElementById('manageBlockedLabel');
      if(el) el.textContent=blockedManagerText().title;
      if (!document.getElementById('blockedManagerModal').classList.contains('hidden')) openBlockedManager();
    }
    function safetyBlockNamesKey() { return safetyStorageKey() + '_names'; }
    function safetyBlockNames() {
      try { var x=JSON.parse(localStorage.getItem(safetyBlockNamesKey()) || '{}'); return x && typeof x === 'object' && !Array.isArray(x) ? x : {}; }
      catch (_) { return {}; }
    }
    function saveSafetyBlockName(uid,name) {
      var names=safetyBlockNames();
      names[uid]=String(name||'').slice(0,100);
      localStorage.setItem(safetyBlockNamesKey(),JSON.stringify(names));
    }
    function refreshBlockedCount() {
      var badge=document.getElementById('blockedCountBadge');
      if (badge) badge.textContent=safetyBlocked.size ? '('+safetyBlocked.size+')' : '';
    }
    function openBlockedManager() {
      loadSafetyBlocked();
      var modal=document.getElementById('blockedManagerModal');
      var t=blockedManagerText();
      document.getElementById('blockedManagerTitle').textContent=t.title;
      document.getElementById('blockedManagerInfo').textContent=t.info;
      document.getElementById('blockedManagerClose').textContent=t.close;
      renderBlockedManager();
      modal.classList.remove('hidden');
    }
    function closeBlockedManager() { document.getElementById('blockedManagerModal').classList.add('hidden'); }
    function renderBlockedManager() {
      var list=document.getElementById('blockedManagerList');
      list.replaceChildren();
      var t=blockedManagerText();
      var names=safetyBlockNames();
      if (!safetyBlocked.size) {
        var empty=document.createElement('p');
        empty.className='text-sm text-slate-500 text-center py-6';
        empty.textContent=t.empty;
        list.appendChild(empty);
      }
      Array.from(safetyBlocked).forEach(function(uid){
        var row=document.createElement('div');row.className='flex items-center gap-2 p-3 rounded-xl border border-slate-200';
        var label=document.createElement('div');label.className='flex-1 min-w-0';
        var name=document.createElement('p');name.className='text-sm font-bold text-slate-800 break-words';name.textContent=names[uid] || t.unknown;
        var sub=document.createElement('p');sub.className='text-[10px] text-slate-400 break-all';sub.textContent=uid.slice(0,12)+'…';
        label.appendChild(name);label.appendChild(sub);
        var btn=document.createElement('button');btn.type='button';btn.className='shrink-0 rounded-lg bg-indigo-600 text-white px-3 py-2 text-xs font-bold';btn.textContent=t.unblock;
        btn.addEventListener('click',function(){
          safetyBlocked.delete(uid);
          localStorage.setItem(safetyStorageKey(),JSON.stringify(Array.from(safetyBlocked)));
          var n=safetyBlockNames();delete n[uid];localStorage.setItem(safetyBlockNamesKey(),JSON.stringify(n));
          refreshBlockedCount();renderBlockedManager();
          if (currentView === 'chat') renderMessages(roomLatestMessages || []);
        });
        row.appendChild(label);row.appendChild(btn);list.appendChild(row);
      });
    }
    function safetyText() { return safetyCopy[currentLang] || safetyCopy.ko; }
    function safetyStorageKey() { return 'localtalk_blocked_v14_' + (myUserId || 'guest'); }
    function loadSafetyBlocked() {
      try {
        var values = JSON.parse(localStorage.getItem(safetyStorageKey()) || '[]');
        safetyBlocked = new Set(Array.isArray(values) ? values.filter(function(x){return typeof x === 'string';}).slice(0,500) : []);
      } catch (_) { safetyBlocked = new Set(); }
      refreshBlockedCount();
    }
    function openSafetyModal(msgId) {
      var msg = roomLatestMessages.find(function(m){return m.id === msgId;});
      if (!msg || !msg.uid || msg.uid === myUserId || msg.isSystem) return;
      safetySelectedMessage = {id:msg.id, uid:msg.uid, sender:String(msg.sender||''), text:String(msg.text||''), city:currentCity.id, room:String(currentRoom)};
      var t=safetyText();
      document.getElementById('safetyTitle').textContent=t.title;
      document.getElementById('safetyTarget').textContent=safetySelectedMessage.sender;
      document.getElementById('safetyReasonLabel').textContent=t.reason;
      document.getElementById('safetyInfo').textContent=t.info;
      document.getElementById('safetyClose').textContent=t.close;
      document.getElementById('safetyReport').textContent=t.report;
      var reason=document.getElementById('safetyReason');
      reason.replaceChildren();
      t.reasons.forEach(function(label,i){var opt=document.createElement('option');opt.value=String(i);opt.textContent=label;reason.appendChild(opt);});
      document.getElementById('safetyBlock').textContent=safetyBlocked.has(msg.uid)?t.unblock:t.block;
      document.getElementById('safetyModal').classList.remove('hidden');
    }
    function closeSafetyModal() {
      document.getElementById('safetyModal').classList.add('hidden');
      safetySelectedMessage=null;
    }
    function toggleSafetyBlock() {
      if (!safetySelectedMessage) return;
      var uid=safetySelectedMessage.uid;
      if (safetyBlocked.has(uid)) safetyBlocked.delete(uid);
      else { safetyBlocked.add(uid); saveSafetyBlockName(uid,safetySelectedMessage.sender); }
      localStorage.setItem(safetyStorageKey(),JSON.stringify(Array.from(safetyBlocked)));
      refreshBlockedCount();
      closeSafetyModal();
      renderMessages(roomLatestMessages);
    }
    function submitSafetyReport() {
      if (!safetySelectedMessage || !requireAuth()) return;
      var m=safetySelectedMessage;
      var reason=document.getElementById('safetyReason').value;
      var btn=document.getElementById('safetyReport');
      btn.disabled=true;
      var reportRef=db.ref('reports').push();
      reportRef.set({
        reporterUid:myUserId, reportedUid:m.uid, cityId:m.city,
        roomId:m.room, messageId:m.id, reason:reason,
        messageText:m.text.slice(0,2000), sender:m.sender.slice(0,100),
        createdAt:firebase.database.ServerValue.TIMESTAMP
      }).then(function(){
        closeSafetyModal(); alert(safetyText().success);
      }).catch(function(e){
        console.error('Report failed',e); alert(safetyText().error);
      }).finally(function(){btn.disabled=false;});
    }

    // All user-controlled content is inserted as text, never parsed as HTML.
    function renderMessages(msgs) {
      loadSafetyBlocked();
      resetTranslationRoom();
      var container = document.getElementById('messageList');
      container.replaceChildren();
      var t = I18N[currentLang] || I18N['ko'];
      if (!roomHistoryReady) return;
      getTranslationControls();
      var visibleMsgs = (msgs || []).filter(function(m) {
        return m && !roomEntryMessageKeys.has(m.id);
      });
      if (visibleMsgs.length === 0 && roomNoticeQueue.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'text-center py-10 text-slate-400 text-xs';
        empty.textContent = t.noMsg;
        container.appendChild(empty);
      }
      function addNotices(position) {
        roomNoticeQueue.forEach(function(notice) {
          if (notice.position !== position) return;
          var wrap = document.createElement('div');
          wrap.className = 'flex justify-center my-1 w-full';
          var text = document.createElement('span');
          text.className = 'bg-slate-200/80 text-slate-600 text-xs px-3.5 py-1 rounded-full font-bold';
          text.textContent = (notice.kind === 'join' ? '👋 ' : '🚪 ') + (notice.actor ? notice.actor + uiText(notice.kind === 'join' ? 'joined' : 'left') : notice.text);
          wrap.appendChild(text);
          container.appendChild(wrap);
        });
      }
      addNotices(0);
      visibleMsgs.forEach(function(m, index) {
        if (!m || typeof m !== 'object') return;
        if (m.isSystem && m.uid === myUserId) return;
        if (!m.isSystem && m.uid !== myUserId && safetyBlocked.has(m.uid)) {
          // Do not render a bubble, a placeholder, or a translation request.
          addNotices(index + 1);
          return;
        }
        if (m.isSystem) {
          var sysWrap = document.createElement('div');
          sysWrap.className = 'flex justify-center my-1 w-full';
          var sysText = document.createElement('span');
          sysText.className = 'bg-slate-200/80 text-slate-600 text-xs px-3.5 py-1 rounded-full font-bold';
          sysText.textContent = '💬 ' + String(m.text || '');
          sysWrap.appendChild(sysText);
          container.appendChild(sysWrap);
          return;
        }
        var mine = m.uid === myUserId;
        var wrapper = document.createElement('div');
        wrapper.className = 'flex flex-col w-full ' + (mine ? 'items-end' : 'items-start');
        var sender = document.createElement('span');
        sender.className = 'text-xs font-bold text-slate-500 px-1 mb-0.5';
        sender.textContent = mine ? getFormattedMySender() + ' (' + uiText('mine') + ')' : String(m.sender || '');
        wrapper.appendChild(sender);
        if (!mine && m.uid) {
          var safetyBtn=document.createElement('button');
          safetyBtn.type='button';
          safetyBtn.className='text-xs text-slate-500 underline mb-1 px-1 self-start';
          safetyBtn.textContent='⚑ '+safetyText().menu;
          safetyBtn.addEventListener('click',function(){openSafetyModal(m.id);});
          wrapper.appendChild(safetyBtn);
        }
        var bubble = document.createElement('div');
        bubble.className = 'max-w-[82%] rounded-2xl p-3 text-xs sm:text-sm leading-relaxed chat-bubble ' +
          (mine ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-white border border-slate-200 text-slate-800 shadow-sm rounded-tl-none');
        var message = document.createElement('div');
        var sharedPlace = parseSharedPlace(m.text);
        if (sharedPlace) renderPlaceCard(bubble,sharedPlace,mine);
        else { message.textContent = String(m.text || ''); bubble.appendChild(message); }
        var localTranslation = document.createElement('div');
        localTranslation.className = 'hidden mt-1.5 pt-1.5 border-t text-xs font-medium chat-bubble ' +
          (mine ? 'border-indigo-400/50 text-amber-200' : 'border-slate-200 text-indigo-700');
        bubble.appendChild(localTranslation);
        wrapper.appendChild(bubble);
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'mt-1 text-xs text-indigo-600 font-bold hover:underline block';
        button.textContent = (I18N[currentLang] || I18N.ko).translate;
        wrapper.appendChild(button);
        if (sharedPlace) { button.classList.add('hidden'); localTranslation.classList.add('hidden'); }
        else renderTranslation(m, localTranslation, button, mine);
        var time = document.createElement('span');
        time.className = 'text-[10px] text-slate-400 px-1 mt-0.5';
        time.textContent = String(m.time || '');
        wrapper.appendChild(time);
        container.appendChild(wrapper);
        addNotices(index + 1);
      });
      var scrollArea = document.getElementById('chatScrollArea');
      scrollArea.scrollTop = scrollArea.scrollHeight;
    }

    function sendMessage() {
      var input = document.getElementById('msgInput');
      var text = input.value.trim();
      sendChatText(text, input);
    }
    function sendChatText(text, input) {
      if (!requireAuth()) return;
      if (!text || !currentCity || !currentRoom) return;
      if (!roomAdmissionReady) {
        alert(uiText('sendNotReady'));
        return;
      }
      if (text.length > 2000) {
        alert(uiText('messageTooLong'));
        return;
      }

      var now = new Date();
      var hours = now.getHours();
      var minutes = now.getMinutes();
      var timeStr = (hours >= 12 ? 'PM' : 'AM') + ' ' + (hours % 12 || 12) + ':' + (minutes < 10 ? '0' : '') + minutes;

      var flagOnly = userCountry ? userCountry.split(' ')[0] : '🌐';
      var myDisplayName = flagOnly + ' ' + userNickname;

      var newMsgRef = db.ref('rooms/' + currentCity.id + '/' + currentRoom + '/messages').push();
      newMsgRef.set({
        id: newMsgRef.key,
        uid: myUserId,
        sender: myDisplayName,
        text: text,
        time: timeStr
      }).catch(function(err) {
        console.error('Message send failed:', err);
        alert(uiText('sendFailed'));
        if (input) input.value = text;
      });

      if (input) { input.value = ''; input.focus(); }
    }

    function changeLanguage(lang) {
      if (document.getElementById('boardNoticeTab')) {
        // Labels are refreshed below once currentLang is assigned.
        setTimeout(function(){selectBoardSection(boardSection);refreshOfficialAdmin();},0);
      }
      if (!I18N[lang]) return;
      currentLang = lang;
      updateMyLocationLabels();
      // Local Talk Korea policy pages follow the app's selected language.
      var policyLinkText = {
        ko:['개인정보처리방침','계정 삭제 안내'],
        en:['Privacy Policy','Account Deletion Help'],
        ja:['プライバシーポリシー','アカウント削除案内'],
        'zh-CN':['隐私政策','账户删除说明']
      }[lang] || ['개인정보처리방침','계정 삭제 안내'];
      var privacyLink = document.getElementById('profilePrivacyPolicyLink');
      var deletionLink = document.getElementById('profileAccountDeletionHelpLink');
      if (privacyLink) {
        privacyLink.textContent = policyLinkText[0];
        privacyLink.href = './privacy.html?lang=' + encodeURIComponent(lang);
      }
      if (deletionLink) {
        deletionLink.textContent = policyLinkText[1];
        deletionLink.href = './delete-account.html?lang=' + encodeURIComponent(lang);
      }
      if (typeof communityLabels === 'function') { communityLabels(); if (currentView === 'board') renderCommunityPosts(); }
      if (currentView === 'board') { updateOfficialSearchUI();renderOfficialNotices(); }
      localStorage.setItem('localtalk_ui_lang', lang);
      if (profileRestoreStarted && userNickname && userCountry) persistProfileV17();
      document.getElementById('langSelect').value = lang;
      translationEpoch++;
      translationPending.clear();
      if (currentView === 'chat') renderMessages(roomLatestMessages || []);
      var t = I18N[currentLang] || I18N['ko'];

      document.getElementById('headerSub').innerText = t.appSub;
      document.getElementById('citySearch').placeholder = t.searchPlaceholder;
      document.getElementById('popularTitle').innerText = t.popularTitle;
      var popularHint = document.getElementById('popularHint');
      if (popularHint) popularHint.textContent = currentLang === 'ko' ? '(여행 정보 · 현지인 채팅)' : currentLang === 'ja' ? '(旅行情報 · 現地チャット)' : currentLang === 'zh-CN' ? '(旅行信息 · 当地聊天)' : '(Travel info · Local chat)';
      document.getElementById('msgInput').placeholder = t.inputPlaceholder;
      document.getElementById('sendBtn').innerText = t.send;

      if (currentCity) {
        var cityName = getCityName(currentCity);
        if (currentView === 'board') {
          document.getElementById('headerTitle').innerText = cityName;
          document.getElementById('headerSub').innerText = t.boardSub;
          document.getElementById('boardBannerTitle').innerText = cityName + t.boardBannerSuffix;
          document.getElementById('boardBannerSub').innerText = t.boardBannerSub;
          document.getElementById('boardPostsTitle').innerHTML = t.boardPostsTitle;
          renderBoardPosts();
        } else if (currentView === 'roomList') {
          document.getElementById('headerTitle').innerText = cityName + t.roomListTitle;
          renderChatRooms();
        } else if (currentView === 'chat') {
          document.getElementById('headerTitle').innerText = cityName + ' Room #' + currentRoom;
          document.getElementById('chatNoticeTitle').innerText = cityName + ' Room #' + currentRoom + ' Q&A';
          document.getElementById('chatNoticeSub').innerText = t.noticeSub;
        }
      }

      if (currentView === 'map') {
        var geoStatus = document.getElementById('mapGeoStatus');
        if (geoStatus && !geoStatus.classList.contains('hidden')) {
          // A language switch should not trigger another location request.
          showMapLocationStatus(geoStatus.dataset.geoState || 'unavailable');
        }
        document.getElementById('headerTitle').innerText = t.mapTitle;
        document.getElementById('headerSub').innerText = t.mapSub;
        loadGoogleMapsScript(currentLang, renderGoogleMap);
      }

      updateStaticUiV9();
      updateStaticUiV10();
      updateProfileLabelsV12();
      updateCountryOptionsV13();
      updateProfileSaveLabelV13();
      refreshBlockedManagerLabels();
      if (currentView === 'roomList') document.getElementById('headerSub').textContent = uiText('roomMax');
      if (currentView === 'chat') {
        var liveCount = roomPreviousUsers ? Object.keys(roomPreviousUsers).length : 0;
        document.getElementById('headerSub').textContent = uiText('nowOnline', liveCount);
      }
      renderCityList(document.getElementById('citySearch').value);
    }

    function filterCities() {
      var query = document.getElementById('citySearch').value;
      renderCityList(query);
    }

    document.getElementById('langSelect').value = currentLang;
    changeLanguage(currentLang);
    // Wait for Firebase authentication and profile restoration before showing setup.
    // The database listeners start only after Firebase authentication succeeds.
