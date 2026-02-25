import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'primereact/button';
import { Card } from 'primereact/card';
import { Checkbox } from 'primereact/checkbox';
import { DataView } from 'primereact/dataview';
import { Dialog } from 'primereact/dialog';
import { Divider } from 'primereact/divider';
import { Dropdown } from 'primereact/dropdown';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { MultiSelect } from 'primereact/multiselect';
import { Password } from 'primereact/password';
import { Tag } from 'primereact/tag';
import { Toast } from 'primereact/toast';

const STORAGE_KEY = 'arte-loader-selection';
const DEFAULT_ROWS = 8;
const ROW_OPTIONS = [5, 8, 10, 20, 50, 100];

function loadSelection() {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function formatDuration(seconds) {
  if (!seconds) return '-';
  return `${Math.floor(seconds / 60)} min`;
}

function formatDate(timestamp) {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat('de-DE').format(new Date(timestamp * 1000));
}

function formatSize(bytes) {
  if (!bytes) return '-';
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function normalizePositiveSize(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return parsed;
}

function normalizeQualities(qualities, fallbackUrl) {
  const list = [];
  const seen = new Set();

  if (Array.isArray(qualities)) {
    qualities.forEach((q, index) => {
      if (!q || typeof q !== 'object') return;
      const url = (q.url || '').trim();
      if (!url || seen.has(url)) return;
      seen.add(url);
      const id = (q.id || `q${index + 1}`).toString();
      list.push({
        id,
        label: q.label || id,
        url,
        size: normalizePositiveSize(q.size)
      });
    });
  }

  if (!list.length && fallbackUrl) {
    list.push({
      id: 'standard',
      label: 'Standard',
      url: fallbackUrl,
      size: 0
    });
  }

  return list;
}

function pickSelectedQuality(qualities, preferred) {
  if (!qualities.length) return '';
  if (preferred && qualities.some((q) => q.id === preferred)) {
    return preferred;
  }
  return qualities[0].id;
}

function getSelectedVideoUrl(entry) {
  if (!entry) return '';

  const qualities = Array.isArray(entry.qualities) ? entry.qualities : [];
  const selected = qualities.find((q) => q.id === entry.selectedQuality);
  if (selected?.url) return selected.url;

  if (qualities[0]?.url) return qualities[0].url;
  return (entry.videoUrl || '').trim();
}

function getQualitySizeForItem(item, qualityId, qualitySizeCache = {}) {
  const fallbackSize = normalizePositiveSize(item?.size);
  const qualities = Array.isArray(item?.qualities) ? item.qualities : [];

  const selected = qualities.find((quality) => quality.id === qualityId) || qualities[0];
  if (!selected) {
    return fallbackSize;
  }

  const directSize = normalizePositiveSize(selected.size);
  if (directSize > 0) {
    return directSize;
  }

  const cachedSize = normalizePositiveSize(qualitySizeCache[selected.url]);
  if (cachedSize > 0) {
    return cachedSize;
  }

  return fallbackSize;
}

function buildSelectionEntryFromResult(item, existing = {}, preferredQuality = '') {
  const qualities = normalizeQualities(
    existing.qualities?.length ? existing.qualities : item.qualities,
    existing.videoUrl || ''
  );
  const selectedQuality = pickSelectedQuality(
    qualities,
    preferredQuality || existing.selectedQuality || item.default_quality
  );

  return {
    video: Boolean(existing.video),
    sub: Boolean(existing.sub),
    title: existing.title || item.title || 'Unbekannte Sendung',
    channel: existing.channel || item.channel || 'Unbekannter Sender',
    timestamp: Number(existing.timestamp) || Number(item.timestamp) || 0,
    subtitleUrl: existing.subtitleUrl || item.subtitle || '',
    qualities,
    selectedQuality,
    videoUrl: getSelectedVideoUrl({ qualities, selectedQuality, videoUrl: existing.videoUrl })
  };
}

function normalizeSelectionMap(rawValue) {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return {};
  }

  const normalized = {};

  Object.entries(rawValue).forEach(([id, value]) => {
    if (!value || typeof value !== 'object') return;

    const qualities = normalizeQualities(value.qualities, value.videoUrl || '');
    const selectedQuality = pickSelectedQuality(qualities, value.selectedQuality);

    const entry = {
      video: Boolean(value.video),
      sub: Boolean(value.sub),
      title: value.title || '',
      channel: value.channel || '',
      timestamp: Number(value.timestamp) || 0,
      subtitleUrl: value.subtitleUrl || '',
      qualities,
      selectedQuality,
      videoUrl: getSelectedVideoUrl({ qualities, selectedQuality, videoUrl: value.videoUrl || '' })
    };

    if (entry.video || entry.sub) {
      normalized[id] = entry;
    }
  });

  return normalized;
}

function App() {
  const toast = useRef(null);
  const [query, setQuery] = useState('');
  const [channels, setChannels] = useState([]);
  const [selectedChannels, setSelectedChannels] = useState([]);
  const [results, setResults] = useState([]);
  const [selection, setSelection] = useState(() =>
    normalizeSelectionMap(loadSelection())
  );
  const [lastSearchQuery, setLastSearchQuery] = useState('');
  const [resultQualitySelection, setResultQualitySelection] = useState({});
  const [qualitySizeCache, setQualitySizeCache] = useState({});
  const [output, setOutput] = useState('');

  const [loadingChannels, setLoadingChannels] = useState(false);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingPyloadSettings, setLoadingPyloadSettings] = useState(false);
  const [savingPyloadSettings, setSavingPyloadSettings] = useState(false);
  const [sendingToPyload, setSendingToPyload] = useState(false);
  const [resultFirst, setResultFirst] = useState(0);

  const [singlePackageDialogVisible, setSinglePackageDialogVisible] = useState(false);
  const [singlePackageName, setSinglePackageName] = useState('');
  const [settingsDialogVisible, setSettingsDialogVisible] = useState(false);
  const [mobilePanel, setMobilePanel] = useState('');
  const [isMobileViewport, setIsMobileViewport] = useState(
    () => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false)
  );

  const [pyloadSettings, setPyloadSettings] = useState({
    server: '',
    username: '',
    password: '',
    resultsPerPage: DEFAULT_ROWS
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const channelOptions = useMemo(
    () => channels.map((channel) => ({ label: channel, value: channel })),
    [channels]
  );

  const qualityOptionsByResult = useMemo(() => {
    const map = {};
    results.forEach((item) => {
      map[item.id] = (item.qualities || []).map((q) => ({
        label: q.label,
        value: q.id
      }));
    });
    return map;
  }, [results]);

  const selectionCount = useMemo(() => Object.keys(selection).length, [selection]);

  const selectedItems = useMemo(
    () =>
      Object.entries(selection)
        .map(([id, entry]) => {
          const qualityOptions = (entry.qualities || []).map((q) => ({
            label: q.label,
            value: q.id
          }));
          const qualityLabel = qualityOptions.find((q) => q.value === entry.selectedQuality)?.label || '-';

          return {
            id,
            video: Boolean(entry.video),
            sub: Boolean(entry.sub),
            title: entry.title || 'Unbekannte Sendung',
            channel: entry.channel || 'Unbekannter Sender',
            timestamp: Number(entry.timestamp) || 0,
            subtitleUrl: entry.subtitleUrl || '',
            qualityOptions,
            selectedQuality: entry.selectedQuality || '',
            qualityLabel
          };
        })
        .sort((a, b) => b.timestamp - a.timestamp),
    [selection]
  );

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  }, [selection]);

  useEffect(() => {
    async function fetchChannels() {
      setLoadingChannels(true);
      try {
        const response = await fetch('/channels');
        if (!response.ok) {
          throw new Error(`Sender konnten nicht geladen werden (${response.status})`);
        }
        const list = await response.json();
        setChannels(Array.isArray(list) ? list : []);
      } catch (error) {
        toast.current?.show({
          severity: 'error',
          summary: 'Fehler',
          detail: error.message,
          life: 4000
        });
      } finally {
        setLoadingChannels(false);
      }
    }

    fetchChannels();
  }, []);

  useEffect(() => {
    function handleResize() {
      setIsMobileViewport(window.innerWidth <= 768);
    }

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!isMobileViewport) {
      setMobilePanel('');
    } else {
      setSettingsDialogVisible(false);
    }
  }, [isMobileViewport]);

  useEffect(() => {
    async function fetchPyloadSettings() {
      setLoadingPyloadSettings(true);
      try {
        const response = await fetch('/pyload/settings');
        if (!response.ok) {
          throw new Error(`Einstellungen konnten nicht geladen werden (${response.status})`);
        }

        const data = await response.json();
        const rows = Number(data.results_per_page) || DEFAULT_ROWS;
        setPyloadSettings({
          server: data.server || '',
          username: data.username || '',
          password: data.password || '',
          resultsPerPage: ROW_OPTIONS.includes(rows) ? rows : DEFAULT_ROWS
        });
        setSettingsLoaded(true);
      } catch (error) {
        toast.current?.show({
          severity: 'error',
          summary: 'Fehler',
          detail: error.message,
          life: 4000
        });
      } finally {
        setLoadingPyloadSettings(false);
      }
    }

    fetchPyloadSettings();
  }, []);

  async function executeSearch(searchQuery, channelFilter, signal) {
    const trimmed = (searchQuery || '').trim();
    if (trimmed.length < 2) {
      setResults([]);
      setResultFirst(0);
      setLoadingSearch(false);
      setLastSearchQuery('');
      return;
    }

    setLastSearchQuery(trimmed);
    setLoadingSearch(true);
    try {
      const params = new URLSearchParams();
      params.set('q', trimmed);
      channelFilter.forEach((channel) => params.append('channels[]', channel));

      const response = await fetch(`/search?${params.toString()}`, { signal });
      if (!response.ok) {
        throw new Error(`Suche fehlgeschlagen (${response.status})`);
      }

      const data = await response.json();
      setResults(Array.isArray(data) ? data : []);
      setResultFirst(0);
      setOutput('');
    } catch (error) {
      if (error.name !== 'AbortError') {
        toast.current?.show({
          severity: 'error',
          summary: 'Fehler',
          detail: error.message,
          life: 4000
        });
      }
    } finally {
      if (!signal || !signal.aborted) {
        setLoadingSearch(false);
      }
    }
  }

  function handleChannelFilterChange(value) {
    const nextChannels = Array.isArray(value) ? value : [];
    setSelectedChannels(nextChannels);

    // Auto-filter only when a result list is already visible.
    if (results.length > 0 && lastSearchQuery.length >= 2) {
      executeSearch(lastSearchQuery, nextChannels);
    }
  }

  function openSettingsPanel() {
    if (isMobileViewport) {
      setMobilePanel((previous) => (previous === 'settings' ? '' : 'settings'));
      return;
    }
    setSettingsDialogVisible(true);
  }

  async function persistResultsPerPage(rows) {
    try {
      const response = await fetch('/pyload/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          results_per_page: rows
        })
      });

      if (!response.ok) {
        throw new Error(`Einstellungen konnten nicht gespeichert werden (${response.status})`);
      }
    } catch (error) {
      toast.current?.show({
        severity: 'error',
        summary: 'Fehler',
        detail: error.message,
        life: 3500
      });
    }
  }

  function handleResultPageChange(event) {
    const nextFirst = Number(event.first) || 0;
    const nextRows = Number(event.rows) || DEFAULT_ROWS;
    const currentRows = Number(pyloadSettings.resultsPerPage) || DEFAULT_ROWS;

    setResultFirst(nextFirst);

    if (nextRows !== currentRows) {
      setResultFirst(0);
      setPyloadSettings((previous) => ({
        ...previous,
        resultsPerPage: nextRows
      }));

      if (settingsLoaded) {
        persistResultsPerPage(nextRows);
      }
    }
  }

  function getResultSelectedQuality(item) {
    const qualityFromSelection = selection[item.id]?.selectedQuality;
    if (qualityFromSelection) return qualityFromSelection;

    const qualityFromDraft = resultQualitySelection[item.id];
    if (qualityFromDraft) return qualityFromDraft;

    return item.default_quality || item.qualities?.[0]?.id || '';
  }

  async function resolveQualitySizesForItem(item) {
    const qualities = Array.isArray(item.qualities) ? item.qualities : [];
    const urls = qualities
      .map((quality) => {
        if (!quality?.url) return '';
        const directSize = normalizePositiveSize(quality.size);
        if (directSize > 0) return '';
        if (normalizePositiveSize(qualitySizeCache[quality.url]) > 0) return '';
        return quality.url;
      })
      .filter(Boolean);

    if (!urls.length) return;

    try {
      const response = await fetch('/quality-sizes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls })
      });

      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      const sizes = payload?.sizes;
      if (!sizes || typeof sizes !== 'object') {
        return;
      }

      setQualitySizeCache((previous) => ({
        ...previous,
        ...sizes
      }));
    } catch {
      // Size lookup is optional; keep the UI responsive if a host blocks HEAD/Range.
    }
  }

  function updateSelectionEntry(id, updater) {
    setSelection((previous) => {
      const current = previous[id];
      if (!current) return previous;

      const next = { ...previous };
      const updated = updater({ ...current });

      if (!updated.video && !updated.sub) {
        delete next[id];
      } else {
        next[id] = {
          ...updated,
          videoUrl: getSelectedVideoUrl(updated)
        };
      }
      return next;
    });
  }

  function toggleSelectionFromResult(item, type, checked) {
    const draftQuality = resultQualitySelection[item.id] || '';

    setSelection((previous) => {
      const next = { ...previous };
      const existing = next[item.id] || {};
      const entry = buildSelectionEntryFromResult(item, existing, draftQuality);
      entry[type] = checked;

      if (!entry.video && !entry.sub) {
        delete next[item.id];
      } else {
        next[item.id] = entry;
      }
      return next;
    });

    if (checked) {
      resolveQualitySizesForItem(item);
    }
  }

  function handleResultQualityChange(item, qualityId) {
    const selectedQuality = pickSelectedQuality(item.qualities || [], qualityId);

    setResultQualitySelection((previous) => ({
      ...previous,
      [item.id]: selectedQuality
    }));

    setSelection((previous) => {
      if (!previous[item.id]) {
        return previous;
      }

      const next = { ...previous };
      const existing = next[item.id];
      const entry = buildSelectionEntryFromResult(item, existing, selectedQuality);
      entry.selectedQuality = pickSelectedQuality(entry.qualities, selectedQuality);

      if (!entry.video && !entry.sub) {
        delete next[item.id];
      } else {
        entry.videoUrl = getSelectedVideoUrl(entry);
        next[item.id] = entry;
      }
      return next;
    });

    resolveQualitySizesForItem(item);
  }

  function handleSelectedQualityChange(itemId, qualityId) {
    setResultQualitySelection((previous) => ({
      ...previous,
      [itemId]: qualityId
    }));

    updateSelectionEntry(itemId, (entry) => ({
      ...entry,
      selectedQuality: pickSelectedQuality(entry.qualities || [], qualityId)
    }));

    const item = results.find((result) => result.id === itemId);
    if (item) {
      resolveQualitySizesForItem(item);
    }
  }

  function removeSelection(id) {
    setSelection((previous) => {
      if (!previous[id]) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
  }

  function buildSelectedLinks() {
    const links = [];

    Object.values(selection).forEach((entry) => {
      if (entry.video) {
        const videoUrl = getSelectedVideoUrl(entry);
        if (videoUrl) links.push(videoUrl);
      }

      if (entry.sub && entry.subtitleUrl) {
        links.push(entry.subtitleUrl);
      }
    });

    return links;
  }

  function handleExport() {
    const links = buildSelectedLinks();
    setOutput(links.join('\n'));

    if (!links.length) {
      toast.current?.show({
        severity: 'warn',
        summary: 'Keine Links',
        detail: 'Bitte zuerst Treffer auswählen.',
        life: 3000
      });
    }
  }

  function buildIndividualPackages() {
    return Object.values(selection)
      .map((entry) => {
        const links = [];

        if (entry.video) {
          const videoUrl = getSelectedVideoUrl(entry);
          if (videoUrl) links.push(videoUrl);
        }

        if (entry.sub && entry.subtitleUrl) {
          links.push(entry.subtitleUrl);
        }

        return {
          name: entry.title || 'Unbenannt',
          links
        };
      })
      .filter((entry) => entry.links.length > 0);
  }

  async function savePyloadSettings(showSuccessToast = true) {
    setSavingPyloadSettings(true);
    try {
      const response = await fetch('/pyload/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server: pyloadSettings.server,
          username: pyloadSettings.username,
          password: pyloadSettings.password,
          results_per_page: pyloadSettings.resultsPerPage
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || `Speichern fehlgeschlagen (${response.status})`);
      }

      if (showSuccessToast) {
        toast.current?.show({
          severity: 'success',
          summary: 'Settings',
          detail: 'Einstellungen gespeichert.',
          life: 3000
        });
      }

      return true;
    } catch (error) {
      toast.current?.show({
        severity: 'error',
        summary: 'Fehler',
        detail: error.message,
        life: 4500
      });
      return false;
    } finally {
      setSavingPyloadSettings(false);
    }
  }

  async function sendPackagesToPyload(packages) {
    if (!pyloadSettings.server || !pyloadSettings.username || !pyloadSettings.password) {
      toast.current?.show({
        severity: 'warn',
        summary: 'Fehlende Daten',
        detail: 'Bitte pyLoad-Server, Benutzer und Passwort eintragen.',
        life: 3500
      });
      return false;
    }

    const settingsSaved = await savePyloadSettings(false);
    if (!settingsSaved) {
      return false;
    }

    if (!packages.length) {
      toast.current?.show({
        severity: 'warn',
        summary: 'Keine Pakete',
        detail: 'In der Auswahl sind keine gültigen Download-Links.',
        life: 3500
      });
      return false;
    }

    setSendingToPyload(true);
    try {
      const response = await fetch('/pyload/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server: pyloadSettings.server,
          username: pyloadSettings.username,
          password: pyloadSettings.password,
          packages
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || `pyLoad-Fehler (${response.status})`);
      }

      const addedCount = payload.added_count || 0;
      const failedCount = payload.failed_count || 0;

      toast.current?.show({
        severity: failedCount > 0 ? 'warn' : 'success',
        summary: 'pyLoad',
        detail: failedCount > 0
          ? `${addedCount} hinzugefügt, ${failedCount} fehlgeschlagen.`
          : `${addedCount} Pakete hinzugefügt.`,
        life: 4500
      });
      return true;
    } catch (error) {
      toast.current?.show({
        severity: 'error',
        summary: 'pyLoad',
        detail: error.message,
        life: 4500
      });
      return false;
    } finally {
      setSendingToPyload(false);
    }
  }

  async function handleSendAsIndividualPackages() {
    const packages = buildIndividualPackages();
    await sendPackagesToPyload(packages);
  }

  function openSinglePackageDialog() {
    setSinglePackageName('');
    setSinglePackageDialogVisible(true);
  }

  async function handleSendAsSinglePackage() {
    const packageName = singlePackageName.trim();
    if (!packageName) {
      toast.current?.show({
        severity: 'warn',
        summary: 'Package-Name fehlt',
        detail: 'Bitte einen Package-Namen eingeben.',
        life: 3000
      });
      return;
    }

    const links = buildSelectedLinks();
    const success = await sendPackagesToPyload([{ name: packageName, links }]);
    if (success) {
      setSinglePackageDialogVisible(false);
      setSinglePackageName('');
    }
  }

  function resultTemplate(item) {
    const selected = selection[item.id] || {};
    const selectedQuality = getResultSelectedQuality(item);
    const selectedSize = getQualitySizeForItem(item, selectedQuality, qualitySizeCache);
    const qualityOptions = qualityOptionsByResult[item.id] || [];
    const videoId = `video-${item.id}`;
    const subtitleId = `subtitle-${item.id}`;

    return (
      <div className="result-row surface-card">
        <div className="result-table-row">
          <div className="result-col-title">
            <div className="font-semibold result-title">{item.title}</div>
            <div className="result-tags">
              <Tag value={item.channel || 'Unbekannt'} severity="info" />
              <Tag value={formatDate(item.timestamp)} />
              <Tag value={formatDuration(item.duration)} severity="success" />
              <Tag value={formatSize(selectedSize)} severity="warning" />
            </div>
          </div>

          <div className="result-controls-group">
            <div className="result-col-video flex justify-content-center">
              <Checkbox
                inputId={videoId}
                checked={Boolean(selected.video)}
                onChange={(event) => toggleSelectionFromResult(item, 'video', event.checked)}
              />
            </div>

            <div className="result-col-quality flex justify-content-center">
              <Dropdown
                id={`quality-${item.id}`}
                value={selectedQuality}
                options={qualityOptions}
                onChange={(event) => handleResultQualityChange(item, event.value)}
                className="quality-compact quality-compact-main"
                placeholder="Q"
                disabled={!qualityOptions.length}
              />
            </div>

            <div className="result-col-ut flex justify-content-center">
              <div className="flex align-items-center gap-2">
                {item.subtitle ? (
                  <Checkbox
                    inputId={subtitleId}
                    checked={Boolean(selected.sub)}
                    onChange={(event) => toggleSelectionFromResult(item, 'sub', event.checked)}
                  />
                ) : (
                  <span className="result-muted">-</span>
                )}
              </div>
            </div>

            <div className="result-col-action flex justify-content-center">
              <Button
                type="button"
                icon="pi pi-external-link"
                text
                rounded
                className="p-button-sm"
                aria-label="Mediathek öffnen"
                onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  function selectedTemplate(item) {
    return (
      <div className="selection-row surface-card">
        <div className="selection-header">
          <div className="font-semibold result-title">{item.title}</div>
          <div className="text-600 selection-meta">{item.channel} • {formatDate(item.timestamp)}</div>
        </div>

        <div className="grid align-items-end selection-controls">
          <div className="col-6 md:col-3">
            <label htmlFor={`sel-video-${item.id}`} className="result-label">Video</label>
            <div className="flex align-items-center mt-2">
              <Checkbox
                inputId={`sel-video-${item.id}`}
                checked={item.video}
                onChange={(event) =>
                  updateSelectionEntry(item.id, (entry) => ({ ...entry, video: event.checked }))
                }
              />
            </div>
          </div>

          <div className="col-6 md:col-4">
            <label htmlFor={`sel-quality-${item.id}`} className="result-label">Qualität</label>
            <Dropdown
              id={`sel-quality-${item.id}`}
              value={item.selectedQuality}
              options={item.qualityOptions}
              onChange={(event) => handleSelectedQualityChange(item.id, event.value)}
              className="quality-compact quality-compact-main mt-2"
              disabled={!item.qualityOptions.length}
            />
          </div>

          <div className="col-6 md:col-4">
            <label htmlFor={`sel-sub-${item.id}`} className="result-label">UT</label>
            <div className="flex align-items-center gap-2 mt-2">
              {item.subtitleUrl ? (
                <Checkbox
                  inputId={`sel-sub-${item.id}`}
                  checked={item.sub}
                  onChange={(event) =>
                    updateSelectionEntry(item.id, (entry) => ({ ...entry, sub: event.checked }))
                  }
                />
              ) : (
                <span className="result-muted">-</span>
              )}
            </div>
          </div>

          <div className="col-6 md:col-1 flex justify-content-end">
            <Button
              type="button"
              icon="pi pi-trash"
              text
              rounded
              severity="danger"
              className="p-button-sm"
              onClick={() => removeSelection(item.id)}
              aria-label="Vormerkung entfernen"
            />
          </div>
        </div>
      </div>
    );
  }

  function renderSearchCard(extraClass = '') {
    return (
      <Card className={`panel-card search-panel search-card ${extraClass}`.trim()}>
        <div className="grid align-items-end">
          <div className="col-12">
            <label htmlFor="query" className="block mb-2">Suche</label>
            <InputText
              id="query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full"
              placeholder="z.B. Arte, Tatort, Doku ..."
            />
          </div>

          <div className="col-12">
            <label htmlFor="channels" className="block mb-2">Sender</label>
            <MultiSelect
              inputId="channels"
              value={selectedChannels}
              options={channelOptions}
              onChange={(event) => handleChannelFilterChange(event.value)}
              optionLabel="label"
              optionValue="value"
              placeholder="Alle Sender"
              display="chip"
              filter
              loading={loadingChannels}
              className="w-full"
              maxSelectedLabels={2}
            />
          </div>

          <div className="col-12">
            <Button
              type="button"
              label="Suchen"
              icon="pi pi-search"
              className="w-full p-button-sm"
              loading={loadingSearch}
              onClick={() => executeSearch(query, selectedChannels)}
            />
          </div>
        </div>
      </Card>
    );
  }

  function renderSelectionCard(extraClass = '') {
    return (
      <Card title={`Vorgemerkt (${selectionCount})`} className={`panel-card ${extraClass}`.trim()}>
        {selectionCount > 0 ? (
          <div className="grid mb-3">
            <div className="col-6">
              <Button
                type="button"
                label="Alle als 1 Package"
                icon="pi pi-box"
                className="p-button-sm w-full"
                severity="success"
                loading={sendingToPyload}
                onClick={openSinglePackageDialog}
                disabled={loadingPyloadSettings || savingPyloadSettings}
              />
            </div>
            <div className="col-6">
              <Button
                type="button"
                label="Jedes als eigenes Package"
                icon="pi pi-cloud-upload"
                className="p-button-sm w-full"
                severity="success"
                loading={sendingToPyload}
                onClick={handleSendAsIndividualPackages}
                disabled={loadingPyloadSettings || savingPyloadSettings}
              />
            </div>
          </div>
        ) : null}
        <DataView
          value={selectedItems}
          itemTemplate={selectedTemplate}
          emptyMessage="Keine vorgemerkten Sendungen."
        />
        <Divider />
        <Button
          type="button"
          label="Linkliste erzeugen"
          icon="pi pi-download"
          className="p-button-sm"
          onClick={handleExport}
        />
        {output.trim() ? (
          <>
            <Divider />
            <InputTextarea
              value={output}
              onChange={(event) => setOutput(event.target.value)}
              rows={8}
              className="w-full"
              placeholder="Exportierte Links erscheinen hier"
            />
          </>
        ) : null}
      </Card>
    );
  }

  function renderSettingsContent() {
    return (
      <div className="flex flex-column gap-3">
        <div>
          <label htmlFor="pyload-server" className="block mb-2">pyLoad Server</label>
          <InputText
            id="pyload-server"
            value={pyloadSettings.server}
            onChange={(event) =>
              setPyloadSettings((previous) => ({
                ...previous,
                server: event.target.value
              }))
            }
            className="w-full"
            placeholder="127.0.0.1:8000"
            disabled={loadingPyloadSettings || sendingToPyload}
          />
        </div>

        <div>
          <label htmlFor="pyload-user" className="block mb-2">Benutzer</label>
          <InputText
            id="pyload-user"
            value={pyloadSettings.username}
            onChange={(event) =>
              setPyloadSettings((previous) => ({
                ...previous,
                username: event.target.value
              }))
            }
            className="w-full"
            disabled={loadingPyloadSettings || sendingToPyload}
          />
        </div>

        <div>
          <label htmlFor="pyload-password" className="block mb-2">Passwort</label>
          <Password
            inputId="pyload-password"
            inputClassName="w-full"
            className="w-full"
            value={pyloadSettings.password}
            onChange={(event) =>
              setPyloadSettings((previous) => ({
                ...previous,
                password: event.target.value
              }))
            }
            feedback={false}
            toggleMask
            disabled={loadingPyloadSettings || sendingToPyload}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            label="Settings speichern"
            icon="pi pi-save"
            className="p-button-sm"
            severity="secondary"
            loading={savingPyloadSettings}
            onClick={() => savePyloadSettings(true)}
            disabled={loadingPyloadSettings || sendingToPyload}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell surface-ground text-sm">
      <Toast ref={toast} />

      <Dialog
        visible={singlePackageDialogVisible}
        header="Alle ausgewählten als 1 Package"
        modal
        closable={!sendingToPyload}
        onHide={() => {
          if (!sendingToPyload) setSinglePackageDialogVisible(false);
        }}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button
              type="button"
              label="Abbrechen"
              icon="pi pi-times"
              text
              className="p-button-sm"
              onClick={() => setSinglePackageDialogVisible(false)}
              disabled={sendingToPyload}
            />
            <Button
              type="button"
              label="Senden"
              icon="pi pi-check"
              className="p-button-sm"
              onClick={handleSendAsSinglePackage}
              loading={sendingToPyload}
              disabled={!singlePackageName.trim()}
            />
          </div>
        }
      >
        <label htmlFor="single-package-name" className="block mb-2">
          Package-Name (Pflicht)
        </label>
        <InputText
          id="single-package-name"
          value={singlePackageName}
          onChange={(event) => setSinglePackageName(event.target.value)}
          className="w-full"
          autoFocus
          disabled={sendingToPyload}
        />
      </Dialog>

      {!isMobileViewport ? (
        <Dialog
          visible={settingsDialogVisible}
          header="Einstellungen"
          modal
          style={{ width: '34rem', maxWidth: '96vw' }}
          onHide={() => setSettingsDialogVisible(false)}
        >
          {renderSettingsContent()}
        </Dialog>
      ) : null}

      <header className="app-topbar">
        <div className="app-topbar-inner">
          <div className="app-brand">
            <div className="app-brand-title">Mediathek Control Center</div>
            <div className="app-brand-subtitle">Treffer verwalten und direkt an pyLoad senden</div>
          </div>
          <div className="flex align-items-center gap-2">
            <Tag value={`${results.length} Treffer`} severity="info" />
            <Tag value={`${selectionCount} vorgemerkt`} severity="success" />
            {!isMobileViewport ? (
              <Button
                type="button"
                icon="pi pi-cog"
                className="p-button-rounded p-button-text p-button-sm"
                aria-label="Einstellungen"
                onClick={openSettingsPanel}
              />
            ) : null}
          </div>
        </div>
      </header>

      <main className="app-main">
        <div className="app-content-grid">
          {!isMobileViewport ? renderSearchCard() : null}

          {!isMobileViewport ? (
            <aside className="selection-panel">
              {renderSelectionCard()}
            </aside>
          ) : null}

          <Card title="Suchergebnisse" className="panel-card results-card">
            <div className="result-columns result-table-head">
              <div className="result-col-title">Titel</div>
              <div className="result-col-video text-center">Video</div>
              <div className="result-col-quality text-center">Qualität</div>
              <div className="result-col-ut text-center">UT</div>
              <div className="result-col-action text-center">Aktion</div>
            </div>
            <DataView
              value={results}
              itemTemplate={resultTemplate}
              layout="list"
              paginator
              paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport RowsPerPageDropdown"
              currentPageReportTemplate="{first} - {last} von {totalRecords}"
              first={resultFirst}
              onPage={handleResultPageChange}
              rows={pyloadSettings.resultsPerPage || DEFAULT_ROWS}
              rowsPerPageOptions={ROW_OPTIONS}
              emptyMessage="Noch keine Ergebnisse."
            />
          </Card>
        </div>
      </main>

      <div className="app-bottom-nav md:hidden">
        <div className="app-bottom-nav-grid">
          <Button
            type="button"
            label="Suche"
            icon="pi pi-search"
            className={`w-full p-button-sm ${mobilePanel === 'search' ? 'active' : ''}`}
            onClick={() => setMobilePanel((previous) => (previous === 'search' ? '' : 'search'))}
          />
          <Button
            type="button"
            label="Vorgemerkt"
            icon="pi pi-bookmark"
            className={`w-full p-button-sm ${mobilePanel === 'selection' ? 'active' : ''}`}
            onClick={() => setMobilePanel((previous) => (previous === 'selection' ? '' : 'selection'))}
          />
          <Button
            type="button"
            label="Einstellungen"
            icon="pi pi-cog"
            className={`w-full p-button-sm ${mobilePanel === 'settings' ? 'active' : ''}`}
            onClick={() => setMobilePanel((previous) => (previous === 'settings' ? '' : 'settings'))}
          />
        </div>
      </div>

      {isMobileViewport && mobilePanel ? (
        <div
          className="mobile-sheet-backdrop"
          role="presentation"
          onClick={() => setMobilePanel('')}
        >
          <div
            className="mobile-sheet-card"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mobile-sheet-header">
              <div className="font-semibold">
                {mobilePanel === 'search'
                  ? 'Suche'
                  : mobilePanel === 'selection'
                    ? `Vorgemerkt (${selectionCount})`
                    : 'Einstellungen'}
              </div>
              <Button
                type="button"
                icon="pi pi-times"
                text
                rounded
                className="p-button-sm"
                onClick={() => setMobilePanel('')}
                aria-label="Popup schließen"
              />
            </div>
            <div className="mobile-sheet-content">
              {mobilePanel === 'search' ? renderSearchCard('mobile-panel-card') : null}
              {mobilePanel === 'selection' ? renderSelectionCard('mobile-panel-card') : null}
              {mobilePanel === 'settings' ? (
                <Card className="panel-card mobile-panel-card">
                  {renderSettingsContent()}
                </Card>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
