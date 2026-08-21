/**
 * Игра с другим человеком по сети — прямое соединение «браузер ↔ браузер»
 * (WebRTC DataChannel). Сервер не нужен: игроки обмениваются короткими кодами
 * приглашения любым удобным способом — мессенджером, почтой, голосом.
 *
 * Порядок:
 *   1. Хозяин нажимает «Создать партию» → получает КОД ПРИГЛАШЕНИЯ.
 *   2. Гость вставляет код → получает КОД ОТВЕТА и отправляет его обратно.
 *   3. Хозяин вставляет код ответа → соединение установлено.
 */

const Multiplayer = (function () {
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  let pc = null;
  let channel = null;
  let role = null;          // 'host' | 'guest'
  let handlers = {};
  let connected = false;
  let myColor = 'w';

  // ---------- Упаковка кодов ----------

  async function compress(text) {
    const bytes = new TextEncoder().encode(text);
    if (typeof CompressionStream === 'undefined') return bytesToBase64(bytes);
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      const buf = await new Response(stream).arrayBuffer();
      return 'Z' + bytesToBase64(new Uint8Array(buf));
    } catch (e) {
      return bytesToBase64(bytes);
    }
  }

  async function decompress(code) {
    const trimmed = code.trim().replace(/\s+/g, '');
    if (trimmed.startsWith('Z')) {
      const bytes = base64ToBytes(trimmed.slice(1));
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const buf = await new Response(stream).arrayBuffer();
      return new TextDecoder().decode(buf);
    }
    return new TextDecoder().decode(base64ToBytes(trimmed));
  }

  function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64ToBytes(b64) {
    const normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /** Ждём, пока соберутся все ICE-кандидаты — тогда SDP самодостаточен. */
  function waitForIce(connection) {
    return new Promise((resolve) => {
      if (connection.iceGatheringState === 'complete') { resolve(); return; }
      const timeout = setTimeout(finish, 4000); // не ждём вечно
      function check() {
        if (connection.iceGatheringState === 'complete') finish();
      }
      function finish() {
        clearTimeout(timeout);
        connection.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
      connection.addEventListener('icegatheringstatechange', check);
    });
  }

  function createPeer() {
    const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    connection.onconnectionstatechange = () => {
      const st = connection.connectionState;
      if (st === 'failed' || st === 'disconnected' || st === 'closed') {
        if (connected) {
          connected = false;
          emit('onDisconnect', st);
        }
      }
    };
    return connection;
  }

  function wireChannel(ch) {
    channel = ch;
    ch.onopen = () => {
      connected = true;
      emit('onConnect', { role, color: myColor });
    };
    ch.onclose = () => {
      if (connected) { connected = false; emit('onDisconnect', 'closed'); }
    };
    ch.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      emit('onMessage', msg);
    };
  }

  function emit(name, payload) {
    if (handlers[name]) handlers[name](payload);
  }

  // ---------- Публичный интерфейс ----------

  function setHandlers(h) { handlers = h || {}; }

  /** Хозяин: создаёт партию и возвращает код приглашения. */
  async function createInvite(color) {
    close();
    role = 'host';
    myColor = color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : color;
    pc = createPeer();
    const ch = pc.createDataChannel('chess', { ordered: true });
    wireChannel(ch);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIce(pc);

    const payload = JSON.stringify({
      v: 1,
      sdp: pc.localDescription.sdp,
      type: pc.localDescription.type,
      // цвет гостя — противоположный цвету хозяина
      guestColor: ChessEngine.opponent(myColor),
    });
    return compress(payload);
  }

  /** Гость: принимает код приглашения и возвращает код ответа. */
  async function acceptInvite(inviteCode) {
    close();
    role = 'guest';
    const data = JSON.parse(await decompress(inviteCode));
    myColor = data.guestColor || 'b';

    pc = createPeer();
    pc.ondatachannel = (e) => wireChannel(e.channel);

    await pc.setRemoteDescription({ type: data.type, sdp: data.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIce(pc);

    const payload = JSON.stringify({
      v: 1,
      sdp: pc.localDescription.sdp,
      type: pc.localDescription.type,
    });
    return { code: await compress(payload), color: myColor };
  }

  /** Хозяин: завершает установку соединения кодом ответа от гостя. */
  async function completeInvite(answerCode) {
    if (!pc) throw new Error('Партия не создана');
    const data = JSON.parse(await decompress(answerCode));
    await pc.setRemoteDescription({ type: data.type, sdp: data.sdp });
  }

  function send(msg) {
    if (channel && channel.readyState === 'open') {
      channel.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  function close() {
    if (channel) { try { channel.close(); } catch (e) {} channel = null; }
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    connected = false;
  }

  function isConnected() { return connected; }
  function getColor() { return myColor; }
  function getRole() { return role; }
  function isSupported() {
    return typeof RTCPeerConnection !== 'undefined';
  }

  return {
    setHandlers, createInvite, acceptInvite, completeInvite,
    send, close, isConnected, getColor, getRole, isSupported,
  };
})();
