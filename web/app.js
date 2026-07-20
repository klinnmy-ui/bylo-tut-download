const API_URL = "https://api.pastvu.com/api2";
const DEFAULT_POINT = [55.7558, 37.6173];
const state = { point: null, photoUrl: null, stream: null, results: [], selectedResult: null, pickerMarker: null, resultMarkers: [] };

const $ = (id) => document.getElementById(id);
const latitude = $("latitude");
const longitude = $("longitude");
const message = $("message");
const searchButton = $("search-button");

const pickerMap = L.map("picker-map", { zoomControl: true }).setView(DEFAULT_POINT, 12);
const resultsMap = L.map("results-map", { zoomControl: true }).setView(DEFAULT_POINT, 12);
[pickerMap, resultsMap].forEach(map => {
  map.attributionControl.setPrefix(false);
});
[pickerMap, resultsMap].forEach(map => L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  keepBuffer: 3,
  updateWhenIdle: false,
  attribution: "© OpenStreetMap contributors"
}).addTo(map));

function keepMapSized(map) {
  map.whenReady(() => setTimeout(() => map.invalidateSize(false), 0));
  const container = map.getContainer();
  if ("ResizeObserver" in window) {
    new ResizeObserver(() => map.invalidateSize(false)).observe(container);
  }
}
[pickerMap, resultsMap].forEach(keepMapSized);
window.addEventListener("resize", () => [pickerMap, resultsMap].forEach(map => map.invalidateSize(false)));

function bindMapControls(map, prefix, onFit) {
  const label = $(`${prefix}-zoom-label`);
  const updateLabel = () => { label.textContent = `Масштаб ${map.getZoom()}`; };
  $(`${prefix}-zoom-in`).addEventListener("click", () => map.zoomIn());
  $(`${prefix}-zoom-out`).addEventListener("click", () => map.zoomOut());
  map.on("zoomend", updateLabel);
  updateLabel();
  onFit(updateLabel);
}

bindMapControls(pickerMap, "picker", () => {
  $("picker-center").addEventListener("click", () => {
    pickerMap.invalidateSize(false);
    pickerMap.setView(state.point ? [state.point.lat, state.point.lon] : DEFAULT_POINT, state.point ? 16 : 12);
  });
});

bindMapControls(resultsMap, "results", () => {
  $("results-fit").addEventListener("click", fitResultsMap);
});

function setMessage(text, error = false) {
  message.textContent = text;
  message.classList.toggle("error", error);
}

function setPoint(lat, lon, source = "Точка установлена") {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    state.point = null;
    $("point-status").textContent = "Некорректные координаты";
    return false;
  }
  state.point = { lat, lon };
  latitude.value = lat.toFixed(6);
  longitude.value = lon.toFixed(6);
  $("point-status").textContent = source;
  if (state.pickerMarker) state.pickerMarker.setLatLng([lat, lon]);
  else state.pickerMarker = L.marker([lat, lon]).addTo(pickerMap);
  pickerMap.setView([lat, lon], Math.max(pickerMap.getZoom(), 15));
  return true;
}

function pointFromInputs() {
  return setPoint(Number(latitude.value.replace(",", ".")), Number(longitude.value.replace(",", ".")), "Введённые координаты");
}

pickerMap.on("click", event => setPoint(event.latlng.lat, event.latlng.lng, "Выбрано на карте"));
latitude.addEventListener("change", pointFromInputs);
longitude.addEventListener("change", pointFromInputs);

function activateMode(button) {
  document.querySelectorAll(".mode-card").forEach(item => item.classList.toggle("active", item === button));
}

$("gallery-button").addEventListener("click", () => $("photo-input").click());
$("photo-input").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  stopCamera();
  activateMode($("gallery-button"));
  if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
  state.photoUrl = URL.createObjectURL(file);
  showPhoto(state.photoUrl);
  resetWorkspaceScroll();
  setMessage("Читаем координаты фотографии на устройстве…");
  try {
    const gps = await exifr.gps(file);
    if (gps?.latitude != null && gps?.longitude != null) {
      setPoint(gps.latitude, gps.longitude, "Координаты из фото");
      setMessage("Координаты извлечены из фотографии. Сам файл никуда не отправлен.");
    } else setMessage("В фото нет доступных координат — укажите точку вручную или на карте.", true);
  } catch {
    setMessage("Не удалось прочитать EXIF — укажите точку вручную или на карте.", true);
  }
});

$("location-button").addEventListener("click", () => {
  activateMode($("location-button"));
  stopCamera();
  $("media-stage").hidden = true;
  requestCurrentPosition();
});

function requestCurrentPosition(fromCamera = false) {
  if (!navigator.geolocation) return setMessage("Этот браузер не поддерживает геопозицию.", true);
  setMessage(fromCamera ? "Камера включена. Определяем текущую позицию…" : "Определяем текущую позицию…");
  navigator.geolocation.getCurrentPosition(
    position => {
      setPoint(position.coords.latitude, position.coords.longitude, "Текущая позиция");
      setMessage(fromCamera
        ? `Камера и позиция готовы, точность около ${Math.round(position.coords.accuracy)} м.`
        : `Позиция определена с точностью около ${Math.round(position.coords.accuracy)} м.`);
    },
    () => setMessage("Не удалось определить позицию. Проверьте разрешение браузера и включение геолокации.", true),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
  );
}

$("camera-button").addEventListener("click", async () => {
  activateMode($("camera-button"));
  try {
    stopCamera();
    state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    $("media-stage").hidden = false;
    $("media-stage").classList.remove("photo-mode");
    $("media-stage").classList.add("camera-mode");
    $("photo-preview").hidden = true;
    $("camera-preview").hidden = false;
    $("capture-button").hidden = false;
    $("camera-preview").srcObject = state.stream;
    updateHistoricalReference();
    if (!state.point) requestCurrentPosition(true);
    else setMessage(state.selectedResult
      ? "Камера включена. Подберите ракурс рядом с выбранным историческим фото."
      : "Камера включена. После поиска выберите историческое фото для сопоставления.");
  } catch {
    setMessage("Камера недоступна. Проверьте разрешение браузера и подключение по HTTPS.", true);
  }
});

$("capture-button").addEventListener("click", () => {
  const video = $("camera-preview");
  const canvas = $("camera-canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  state.photoUrl = canvas.toDataURL("image/jpeg", 0.92);
  stopCamera();
  showPhoto(state.photoUrl);
  setMessage("Снимок хранится только в памяти этой страницы и никуда не отправляется.");
});

function showPhoto(url) {
  $("media-stage").hidden = false;
  $("media-stage").classList.add("photo-mode");
  $("media-stage").classList.remove("camera-mode");
  $("photo-preview").src = url;
  $("photo-preview").hidden = false;
  $("camera-preview").hidden = true;
  $("capture-button").hidden = true;
  updateHistoricalReference();
  document.body.classList.add("has-media");
}

function updateHistoricalReference() {
  const reference = $("historical-reference");
  const photo = state.selectedResult;
  reference.hidden = !photo;
  $("media-stage").classList.toggle("with-reference", Boolean(photo));
  if (!photo) return;
  $("historical-reference-image").src = photo.thumb || "icons/icon.svg";
  $("historical-reference-image").alt = photo.title;
  const link = $("historical-reference-link");
  link.textContent = photo.title;
  link.href = photo.page || "#";
}

function resetWorkspaceScroll() {
  requestAnimationFrame(() => {
    document.querySelector(".search-panel").scrollTo({ top: 0, behavior: "auto" });
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  });
}

function stopCamera() {
  state.stream?.getTracks().forEach(track => track.stop());
  state.stream = null;
  $("camera-preview").srcObject = null;
}

searchButton.addEventListener("click", async () => {
  if (!pointFromInputs()) return setMessage("Укажите корректные широту и долготу.", true);
  state.selectedResult = null;
  updateHistoricalReference();
  const radius = Number(document.querySelector('input[name="radius"]:checked').value);
  const params = JSON.stringify({ geo: [state.point.lat, state.point.lon], limit: 30, distance: radius, type: "photo" });
  const url = `${API_URL}?method=photo.giveNearestPhotos&params=${encodeURIComponent(params)}`;
  searchButton.disabled = true;
  setMessage("Ищем фотографии PastVu…");
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.results = parseResults(payload);
    renderResults();
    setMessage(state.results.length ? `Найдено фотографий: ${state.results.length}.` : "В выбранном радиусе фотографии не найдены.");
  } catch (error) {
    setMessage(`Поиск не выполнен: ${error.message}`, true);
  } finally {
    searchButton.disabled = false;
  }
});

function parseResults(payload) {
  if (payload.error) throw new Error(String(payload.error));
  const result = payload.result;
  const items = Array.isArray(result) ? result : result?.photos || result?.items || result?.data || result?.list || [];
  return items.map(item => {
    const geo = Array.isArray(item.geo) ? item.geo : null;
    const lat = geo?.[0] ?? item.lat ?? item.latitude ?? item.y;
    const lon = geo?.[1] ?? item.lon ?? item.lng ?? item.longitude ?? item.x;
    const id = item.cid ?? item.id ?? item._id;
    const file = item.file;
    return {
      id, lat: Number(lat), lon: Number(lon), title: item.title || item.name || item.caption || "Без названия",
      year: item.year2 && item.year2 !== item.year ? `${item.year || ""}–${item.year2}` : item.year || item.date || item.period || "Год не указан",
      distance: item.distance ?? (Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))
        ? distanceMeters(state.point.lat, state.point.lon, Number(lat), Number(lon)) : null),
      direction: item.dir, thumb: file ? `https://img.pastvu.com/h/${file}` : null,
      page: id ? `https://pastvu.com/p/${id}` : null
    };
  });
}

function renderResults() {
  const list = $("results-list");
  const comparison = $("comparison");
  comparison.hidden = true;
  comparison.replaceChildren();
  document.querySelector(".results-panel").classList.remove("has-comparison");
  list.replaceChildren();
  state.resultMarkers.forEach(marker => marker.remove());
  state.resultMarkers = [];
  if (!state.results.length) list.innerHTML = '<div class="empty-state">В выбранном радиусе фотографии не найдены.</div>';
  const bounds = [];
  state.results.forEach((photo, index) => {
    const fragment = $("result-template").content.cloneNode(true);
    const card = fragment.querySelector("article");
    const image = fragment.querySelector("img");
    image.src = photo.thumb || "icons/icon.svg";
    image.alt = photo.title;
    const link = fragment.querySelector("a");
    link.textContent = photo.title;
    link.href = photo.page || "#";
    fragment.querySelector(".result-meta").textContent = [photo.year, photo.distance != null ? `≈ ${Math.round(photo.distance)} м` : null].filter(Boolean).join(" · ");
    fragment.querySelector(".result-direction").textContent = photo.direction ? `Направление PastVu: ${photo.direction}` : "Направление не указано";
    card.addEventListener("click", event => { if (event.target !== link) selectResult(index); });
    list.append(fragment);
    if (Number.isFinite(photo.lat) && Number.isFinite(photo.lon)) {
      bounds.push([photo.lat, photo.lon]);
      const rotation = directionDegrees(photo.direction);
      const icon = L.divIcon({
        className: "",
        html: `<div class="pastvu-marker" title="${escapeHtml(photo.title)}"><span style="transform:rotate(${rotation}deg)">↑</span></div>`,
        iconSize: [30, 30], iconAnchor: [15, 15]
      });
      const marker = L.marker([photo.lat, photo.lon], { icon }).addTo(resultsMap).bindTooltip(escapeHtml(photo.title));
      marker.on("click", () => selectResult(index));
      state.resultMarkers.push(marker);
    }
  });
  if (state.point) bounds.push([state.point.lat, state.point.lon]);
  state.resultBounds = bounds;
  fitResultsMap();
}

function fitResultsMap() {
  resultsMap.invalidateSize(false);
  if (state.resultBounds?.length) resultsMap.fitBounds(state.resultBounds, { padding: [30, 30], maxZoom: 17 });
  else if (state.point) resultsMap.setView([state.point.lat, state.point.lon], 16);
}

function selectResult(index) {
  const photo = state.results[index];
  state.selectedResult = photo;
  updateHistoricalReference();
  const comparison = $("comparison");
  const figures = [];
  if (state.photoUrl) figures.push(`<figure><img src="${state.photoUrl}" alt="Современное фото"><figcaption>Современное фото</figcaption></figure>`);
  const pastVuCaption = photo.page
    ? `<a href="${photo.page}" target="_blank" rel="noreferrer">${escapeHtml(photo.title)}</a>`
    : escapeHtml(photo.title);
  figures.push(`<figure><img src="${photo.thumb || "icons/icon.svg"}" alt="${escapeHtml(photo.title)}"><figcaption>${pastVuCaption}</figcaption></figure>`);
  comparison.innerHTML = figures.join("");
  comparison.hidden = false;
  document.querySelector(".results-panel").classList.add("has-comparison");
  comparison.querySelectorAll("img").forEach(image => image.addEventListener("click", () => openPhotoViewer(image)));
  setTimeout(() => resultsMap.invalidateSize({ pan: false }), 0);
}

const photoViewer = $("photo-viewer");
const photoViewerImage = $("photo-viewer-image");
let photoZoom = 1;

function applyPhotoZoom() {
  photoViewerImage.style.transform = `scale(${photoZoom})`;
  $("photo-zoom-reset").textContent = `${Math.round(photoZoom * 100)}%`;
}

function openPhotoViewer(source) {
  photoViewerImage.src = source.currentSrc || source.src;
  photoViewerImage.alt = source.alt;
  photoZoom = 1;
  applyPhotoZoom();
  photoViewer.showModal();
}

$("photo-zoom-in").addEventListener("click", () => { photoZoom = Math.min(4, photoZoom + .25); applyPhotoZoom(); });
$("photo-zoom-out").addEventListener("click", () => { photoZoom = Math.max(.5, photoZoom - .25); applyPhotoZoom(); });
$("photo-zoom-reset").addEventListener("click", () => { photoZoom = 1; applyPhotoZoom(); });
$("photo-viewer-close").addEventListener("click", () => photoViewer.close());
photoViewer.addEventListener("click", event => { if (event.target === photoViewer) photoViewer.close(); });

document.querySelectorAll(".view-switch button").forEach(button => button.addEventListener("click", () => {
  document.querySelectorAll(".view-switch button").forEach(item => item.classList.toggle("active", item === button));
  const mapMode = button.dataset.view === "map";
  document.querySelector(".results-panel").classList.toggle("map-mode", mapMode);
  $("results-list").hidden = mapMode;
  $("results-map-pane").hidden = !mapMode;
  if (mapMode) setTimeout(fitResultsMap, 0);
}));

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function directionDegrees(direction) {
  const names = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 };
  const numeric = Number(direction);
  return Number.isFinite(numeric) ? numeric : names[String(direction || "").toLowerCase()] ?? 0;
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = value => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

window.addEventListener("beforeunload", stopCamera);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
