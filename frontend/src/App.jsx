import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUp,
  CaretDown,
  CaretRight,
  Cube,
  ContactlessPayment,
  FileAudio,
  FloppyDisk,
  Folder,
  FolderOpen,
  GearSix,
  House,
  PencilSimple,
  Plus,
  Trash,
  UploadSimple,
  Wrench,
} from '@phosphor-icons/react';
import { Avatar } from 'primereact/avatar';
import { Badge } from 'primereact/badge';
import { Button } from 'primereact/button';
import { Card } from 'primereact/card';
import { Divider } from 'primereact/divider';
import { Dropdown } from 'primereact/dropdown';
import { FileUpload } from 'primereact/fileupload';
import { InputText } from 'primereact/inputtext';
import { Message } from 'primereact/message';
import { MeterGroup } from 'primereact/metergroup';
import { Messages } from 'primereact/messages';
import { ProgressBar } from 'primereact/progressbar';
import { Slider } from 'primereact/slider';
import { Stepper } from 'primereact/stepper';
import { StepperPanel } from 'primereact/stepperpanel';
import { Tag } from 'primereact/tag';
import { Toast } from 'primereact/toast';
import {
  assignTag,
  claimTag,
  createMediaFolder,
  deleteMedia,
  deleteTag,
  getBoxes,
  getBoxLocalTags,
  getBoxTags,
  getBoxDetails,
  getBoxStorage,
  getMediaTree,
  getStatus,
  getTagBlocks,
  getTags,
  markTagWritten,
  moveMedia,
  pairBox,
  pullTagFromBox,
  renameMedia,
  sendCommand,
  setBoxAlias,
  setTagAlias,
  setTagBlock,
  setTagMedia,
  unassignTag,
  unpairBox,
  uploadMedia,
} from './api.js';

const BOX_POLL_MS = 1500;
const STATUS_POLL_MS = 1000;
const STORAGE_POLL_MS = 5000;
const ONLINE_THRESHOLD_SEC = 60;

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: House },
  { id: 'boxes', label: 'Boxen', icon: Cube },
  { id: 'media', label: 'Medien', icon: FolderOpen },
  { id: 'tags', label: 'Tags', icon: ContactlessPayment },
  { id: 'settings', label: 'Einstellungen', icon: GearSix },
];

function formatTime(ts) {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleString();
}

function getAvailability(lastSeen) {
  if (!lastSeen) {
    return { label: 'Offline', severity: 'danger' };
  }
  const nowSec = Date.now() / 1000;
  const isOnline = nowSec - lastSeen <= ONLINE_THRESHOLD_SEC;
  return { label: isOnline ? 'Online' : 'Offline', severity: isOnline ? 'success' : 'danger' };
}

function parseCapabilities(raw) {
  if (!raw) return '-';
  try {
    const data = JSON.parse(raw);
    return Object.entries(data)
      .map(([key, value]) => `${key}:${value ? '1' : '0'}`)
      .join(' ');
  } catch (error) {
    return '-';
  }
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '-';
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatClock(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '-';
  const total = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function capacityScale(percent) {
  const p = Math.max(0, Math.min(100, percent || 0));
  if (p === 0) return 1;
  return 100 / p;
}

function getNfcKey(nfc) {
  if (!nfc) return '';
  const at = nfc.at || '';
  const uid = nfc.uid || '';
  const hardware = nfc.hardwareUid || nfc.hardware_uid || '';
  return `${at}:${uid}:${hardware}`;
}

function generateTagId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let generated = '';
  for (let i = 0; i < 10; i += 1) {
    generated += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return generated;
}

function generateHardwareUid() {
  const bytes = [];
  for (let i = 0; i < 7; i += 1) {
    bytes.push(Math.floor(Math.random() * 256));
  }
  return bytes
    .map((value) => value.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
}

function isValidTagUid(uid) {
  return /^(?:[a-z0-9]{10}|TAG_[a-z0-9]{8})$/.test(uid);
}

function SectionHeader({ title, subtitle, actions }) {
  return (
    <div className="section-header">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="section-actions">{actions}</div>
    </div>
  );
}

function StatGrid({ items }) {
  return (
    <div className="stat-grid">
      {items.map((card) => (
        <Card key={card.label} className="stat-card">
          <p className="stat-label">{card.label}</p>
          <div className="stat-value">{card.value}</div>
          <span className="stat-helper">{card.helper}</span>
        </Card>
      ))}
    </div>
  );
}

export default function App() {
  const [activeSection, setActiveSection] = useState('dashboard');
  const [searchValue, setSearchValue] = useState('');
  const [boxes, setBoxes] = useState([]);
  const [boxStorage, setBoxStorage] = useState({});
  const [selectedId, setSelectedId] = useState('');
  const [boxDetailsOpen, setBoxDetailsOpen] = useState(false);
  const [boxDetailsLoading, setBoxDetailsLoading] = useState(false);
  const [boxDetailsError, setBoxDetailsError] = useState('');
  const [boxDetailsData, setBoxDetailsData] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [nfcUid, setNfcUid] = useState('UID_1');
  const [mediaTree, setMediaTree] = useState(null);
  const [mediaError, setMediaError] = useState('');
  const [currentPath, setCurrentPath] = useState('');
  const [selectedPaths, setSelectedPaths] = useState([]);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameName, setRenameName] = useState('');
  const [moveTarget, setMoveTarget] = useState('');
  const [activeModal, setActiveModal] = useState('');
  const [tagDeleteTarget, setTagDeleteTarget] = useState('');
  const [expandedFolders, setExpandedFolders] = useState(() => new Set(['__root__']));
  const [sidebarQuery, setSidebarQuery] = useState('');
  const [uploadAfterCreate, setUploadAfterCreate] = useState(false);
  const [pendingUploadFiles, setPendingUploadFiles] = useState([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadInProgress, setUploadInProgress] = useState(false);
  const [activeUploadLabel, setActiveUploadLabel] = useState('');
  const [uploadSize, setUploadSize] = useState(0);
  const [uploadNameError, setUploadNameError] = useState('');
  const transferTimerRef = useRef(null);
  const explorerRef = useRef(null);
  const modalRef = useRef(null);
  const toastRef = useRef(null);
  const fileUploadRef = useRef(null);
  const dragSelectRef = useRef(false);
  const lastDblClickRef = useRef(0);
  const lastAnchorRef = useRef('');
  const explorerInitRef = useRef(false);
  const expandedInitRef = useRef(false);
  const volumeRef = useRef(null);
  const [tags, setTags] = useState([]);
  const [boxTags, setBoxTags] = useState([]);
  const [blockedByBox, setBlockedByBox] = useState({});
  const [dbTagMedia, setDbTagMedia] = useState({});
  const [localBoxTags, setLocalBoxTags] = useState([]);
  const [localBoxError, setLocalBoxError] = useState('');
  const [importTargetFolder, setImportTargetFolder] = useState('');
  const [importTargetUid, setImportTargetUid] = useState('');
  const [scanTagUid, setScanTagUid] = useState('');
  const [tagUidMode, setTagUidMode] = useState('keep');
  const [tagUidError, setTagUidError] = useState('');
  const [tagStep, setTagStep] = useState(0);
  const [tagStepOneDone, setTagStepOneDone] = useState(false);
  const [tagStepTwoDone, setTagStepTwoDone] = useState(false);
  const [tagStepMax, setTagStepMax] = useState(0);
  const tagStepperRef = useRef(null);
  const tagWizardRestoredRef = useRef('');
  const tagUidMsgRef = useRef(null);
  const mediaMsgRef = useRef(null);
  const autoReplaceMsg = 'Ungueltige ID erkannt – wird automatisch ersetzt.';
  const [dismissedNfcKey, setDismissedNfcKey] = useState('');
  const [scanTagLabel, setScanTagLabel] = useState('');
  const [scanMediaPath, setScanMediaPath] = useState('');
  const [reuseTagUid, setReuseTagUid] = useState('');
  const lastNfcKeyRef = useRef('');
  const [tagAliasDrafts, setTagAliasDrafts] = useState({});
  const [boxAliasDrafts, setBoxAliasDrafts] = useState({});
  const [showSessionSheet, setShowSessionSheet] = useState(false);
  const [drawerTab, setDrawerTab] = useState('boxes');
  const [boxDeleteTarget, setBoxDeleteTarget] = useState('');
  const [lastHardwareUid, setLastHardwareUid] = useState({ uid: '', hardwareUid: '' });
  const [simulatedNfc, setSimulatedNfc] = useState(null);
  const [showVolume, setShowVolume] = useState(false);
  const [volumeDraft, setVolumeDraft] = useState(50);
  const [seekPercent, setSeekPercent] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);

  function addToast(type, message) {
    toastRef.current?.show({
      severity: type,
      summary: type === 'error' ? 'Fehler' : 'Info',
      detail: message,
      life: 4000,
    });
  }

  async function handleShowBoxDetails(boxId) {
    setBoxDetailsOpen(true);
    setBoxDetailsLoading(true);
    setBoxDetailsError('');
    setBoxDetailsData(null);
    const response = await getBoxDetails(boxId);
    if (!response.ok) {
      const message = response.data.detail || 'Box-Details konnten nicht geladen werden.';
      setBoxDetailsError(message);
      addToast('error', message);
      setBoxDetailsLoading(false);
      return;
    }
    setBoxDetailsData(response.data || null);
    setBoxDetailsLoading(false);
  }

  useEffect(() => {
    let active = true;

    async function refreshBoxes() {
      const response = await getBoxes();
      if (!active) return;
      if (!response.ok) {
        setError(response.data.detail || 'Fehler beim Laden der Boxen.');
        return;
      }
      setBoxes(response.data.boxes || []);
      setError('');
    }

    refreshBoxes();
    const handle = setInterval(refreshBoxes, BOX_POLL_MS);
    return () => {
      active = false;
      clearInterval(handle);
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function refreshStorage() {
      if (!boxes.length) {
        if (active) setBoxStorage({});
        return;
      }
      const results = await Promise.all(
        boxes.map(async (box) => {
          const response = await getBoxStorage(box.box_id);
          if (!response.ok) {
            return { boxId: box.box_id, storage: null };
          }
          return { boxId: box.box_id, storage: response.data.storage || null };
        })
      );
      if (!active) return;
      const next = {};
      results.forEach(({ boxId, storage }) => {
        if (!storage) {
          next[boxId] = null;
          return;
        }
        const total = storage.total_bytes ?? null;
        const free = storage.free_bytes ?? null;
        const used =
          storage.used_bytes ?? (total !== null && free !== null ? total - free : null);
        next[boxId] = { total, free, used };
      });
      setBoxStorage(next);
    }

    refreshStorage();
    const handle = setInterval(refreshStorage, STORAGE_POLL_MS);
    return () => {
      active = false;
      clearInterval(handle);
    };
  }, [boxes]);

  useEffect(() => {
    function handleOutside(event) {
      if (activeModal) return;
      if (!explorerRef.current) return;
      if (modalRef.current && modalRef.current.contains(event.target)) return;
      if (!explorerRef.current.contains(event.target)) {
        setSelectedPaths([]);
        setRenameName('');
      }
    }
    function handleMouseUp() {
      dragSelectRef.current = false;
    }
    window.addEventListener('mousedown', handleOutside);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeModal]);

  useEffect(() => {
    if (!selectedId) {
      setStatus(null);
      setMediaTree(null);
      setMediaError('');
      setSelectedPaths([]);
      setNewFolderName('');
      setRenameName('');
      setActiveModal('');
      setBoxTags([]);
      setDbTagMedia({});
      setScanTagUid('');
      setScanTagLabel('');
      setScanMediaPath('');
      setReuseTagUid('');
      setLocalBoxTags([]);
      setLocalBoxError('');
      return;
    }

    let active = true;

    async function refreshStatus() {
      const response = await getStatus(selectedId);
      if (!active) return;
      if (!response.ok) {
        setStatus({ error: response.data.detail || 'Status nicht verfuegbar.' });
        return;
      }
      setStatus(response.data);
    }

    refreshStatus();
    const handle = setInterval(refreshStatus, STATUS_POLL_MS);
    return () => {
      active = false;
      clearInterval(handle);
    };
  }, [selectedId]);

  useEffect(() => {
    let active = true;

    async function refreshMedia() {
      const response = await getMediaTree();
      if (!active) return;
      if (!response.ok) {
        setMediaError(response.data.detail || 'Medien nicht verfuegbar.');
        setMediaTree(null);
        return;
      }
      setMediaTree(response.data);
      setMediaError('');
    }

    refreshMedia();
    return () => {
      active = false;
    };
  }, []);

  function findPathChain(node, target, chain = []) {
    if (!node) return null;
    const currentPath = node.path || '';
    const nextChain = [...chain, currentPath];
    if (currentPath === target) {
      return nextChain;
    }
    if (!Array.isArray(node.children)) return null;
    for (const child of node.children) {
      if (child.type !== 'folder') continue;
      const result = findPathChain(child, target, nextChain);
      if (result) return result;
    }
    return null;
  }

  useEffect(() => {
    if (!mediaTree) return;
    const saved = localStorage.getItem('klangkiste_explorer_path');
    if (saved === null) return;
    const chain = findPathChain(mediaTree, saved);
    if (!chain) return;
    setCurrentPath(saved);
    if (!expandedInitRef.current) {
      const savedExpandedRaw = localStorage.getItem('klangkiste_explorer_expanded');
      let savedExpanded = [];
      if (savedExpandedRaw) {
        try {
          const parsed = JSON.parse(savedExpandedRaw);
          if (Array.isArray(parsed)) {
            savedExpanded = parsed;
          }
        } catch (error) {
          savedExpanded = [];
        }
      }
      const merged = new Set([
        ...savedExpanded,
        ...chain.map((p) => (p ? p : '__root__')),
      ]);
      setExpandedFolders(merged);
      expandedInitRef.current = true;
    }
    explorerInitRef.current = true;
  }, [mediaTree]);

  useEffect(() => {
    if (!explorerInitRef.current) return;
    localStorage.setItem('klangkiste_explorer_path', currentPath || '');
  }, [currentPath]);

  useEffect(() => {
    if (!expandedInitRef.current) return;
    localStorage.setItem(
      'klangkiste_explorer_expanded',
      JSON.stringify(Array.from(expandedFolders))
    );
  }, [expandedFolders]);

  useEffect(() => {
    const lastNfc = status?.last_nfc;
    if (!lastNfc || !lastNfc.uid) {
      return;
    }
    if (!lastNfc.known) {
      const key = `${status?.last_nfc_at ?? ''}:${lastNfc.uid ?? ''}`;
      if (lastNfcKeyRef.current === key) {
        return;
      }
      lastNfcKeyRef.current = key;
      setScanTagLabel('');
      setScanMediaPath('');
      if (isValidTagUid(lastNfc.uid)) {
        setScanTagUid(lastNfc.uid);
        setTagUidMode('keep');
        setTagUidError('');
      } else {
        setScanTagUid(generateTagId());
        setTagUidMode('new');
        setTagUidError(autoReplaceMsg);
      }
      setDismissedNfcKey('');
      setTagStep(0);
      setTagStepOneDone(false);
      setTagStepTwoDone(false);
      setTagStepMax(0);
    }
  }, [status, tags]);

  useEffect(() => {
    tagStepperRef.current?.setActiveStep(tagStep);
  }, [tagStep]);

  useEffect(() => {
    const ref = tagUidMsgRef.current;
    if (!ref) return;
    ref.clear();
    if (tagStep === 0 && tagUidError) {
      const showMessage = () => {
        if (!tagUidMsgRef.current) return false;
        tagUidMsgRef.current.clear();
        tagUidMsgRef.current.show({
          severity: 'warn',
          summary: 'Ungueltige ID',
          detail: tagUidError,
          sticky: true,
          closable: false,
        });
        return true;
      };
      if (!showMessage()) {
        const timer = setTimeout(() => {
          showMessage();
        }, 0);
        return () => clearTimeout(timer);
      }
    }
  }, [tagUidError, tagStep]);

  useEffect(() => {
    const ref = mediaMsgRef.current;
    if (!ref) return;
    ref.clear();
    if (tagStep === 1 && !scanMediaPath) {
      const showMessage = () => {
        if (!mediaMsgRef.current) return false;
        mediaMsgRef.current.clear();
        mediaMsgRef.current.show({
          severity: 'info',
          summary: 'Keine Medienzuordnung',
          detail: 'Ohne Medienauswahl wird der Tag ohne Zuordnung gespeichert.',
          sticky: true,
          closable: false,
        });
        return true;
      };
      if (!showMessage()) {
        const timer = setTimeout(() => {
          showMessage();
        }, 0);
        return () => clearTimeout(timer);
      }
    }
  }, [scanMediaPath, tagStep]);

  useEffect(() => {
    let active = true;

    async function refreshTags() {
      const response = await getTags();
      if (!active) return;
      if (!response.ok) {
        setError(response.data.detail || 'Tags nicht verfuegbar.');
        return;
      }
      setTags(response.data.tags || []);
    }

    refreshTags();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;

    async function refreshBoxTags() {
      const response = await getBoxTags(selectedId);
      if (!active) return;
      if (!response.ok) {
        setError(response.data.detail || 'Box-Tags nicht verfuegbar.');
        return;
      }
      setBoxTags(response.data.tags || []);
    }

    refreshBoxTags();
    return () => {
      active = false;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;

    async function refreshLocalTags() {
      const response = await getBoxLocalTags(selectedId);
      if (!active) return;
      if (!response.ok) {
        setLocalBoxError(response.data.detail || 'Lokale Box-Tags nicht verfuegbar.');
        return;
      }
      setLocalBoxTags(response.data.tags || []);
      setLocalBoxError('');
    }

    refreshLocalTags();
    return () => {
      active = false;
    };
  }, [selectedId]);

  useEffect(() => {
    let active = true;

    async function refreshBlocked() {
      if (!boxes.length) {
        setBlockedByBox({});
        return;
      }
      const results = await Promise.all(
        boxes.map(async (box) => {
          const response = await getTagBlocks(box.box_id);
          return { boxId: box.box_id, response };
        })
      );
      if (!active) return;
      const next = {};
      results.forEach(({ boxId, response }) => {
        if (response.ok) {
          next[boxId] = response.data.blocked || [];
        }
      });
      setBlockedByBox(next);
    }

    refreshBlocked();
    return () => {
      active = false;
    };
  }, [boxes]);

  const unpaired = useMemo(
    () => boxes.filter((box) => box.state === 'UNPAIRED'),
    [boxes]
  );
  const paired = useMemo(
    () => boxes.filter((box) => box.state === 'PAIRED'),
    [boxes]
  );

  const mediaTagCounts = useMemo(() => {
    const counts = {};
    tags.forEach((tag) => {
      const mediaPath = tag.media_path || '';
      if (!mediaPath) return;
      counts[mediaPath] = (counts[mediaPath] || 0) + 1;
    });
    return counts;
  }, [tags]);

  const topLevelFolders = useMemo(() => {
    if (!mediaTree || !Array.isArray(mediaTree.children)) return [];
    const folders = mediaTree.children.filter((child) => child.type === 'folder');
    const query = sidebarQuery.trim().toLowerCase();
    if (!query) return folders;
    return folders.filter((folder) => (folder.name || '').toLowerCase().includes(query));
  }, [mediaTree, sidebarQuery]);

  const filteredTree = useMemo(() => {
    if (!mediaTree) return null;
    return {
      ...mediaTree,
      children: topLevelFolders,
    };
  }, [mediaTree, topLevelFolders]);

  const dashboardStats = useMemo(() => {
    const sizeLabel = mediaTree ? formatSize(mediaTree.size) : '-';
    const freeLabel = mediaTree ? formatSize(mediaTree.free_bytes) : '-';
    return [
      {
        label: 'Gepairte Boxen',
        value: paired.length,
        helper: `${unpaired.length} neu`,
      },
      {
        label: 'Tags gesamt',
        value: tags.length,
        helper: `${boxTags.length} auf Box`,
      },
      {
        label: 'Medien gesamt',
        value: sizeLabel,
        helper: `frei ${freeLabel}`,
      },
      {
        label: 'Letzter NFC',
        value: status?.last_nfc?.uid || '-',
        helper: status?.last_nfc_at ? formatTime(status.last_nfc_at) : '-',
      },
    ];
  }, [paired.length, unpaired.length, tags.length, boxTags.length, mediaTree, status]);

  async function handlePair(boxId) {
    const response = await pairBox(boxId);
    if (!response.ok) {
      setError(response.data.detail || 'Box pairing fehlgeschlagen.');
      addToast('error', response.data.detail || 'Box pairing fehlgeschlagen.');
      return;
    }
    addToast('success', 'Box gepairt.');
    const updated = await getBoxes();
    if (updated.ok) {
      setBoxes(updated.data.boxes || []);
    }
  }

  async function handleCommand(command, payload = {}) {
    if (!selectedId) {
      setError('Bitte zuerst eine Box auswaehlen.');
      addToast('error', 'Bitte zuerst eine Box auswaehlen.');
      return;
    }
    let nextPayload = payload;
    if (command === 'nfc_on' || command === 'nfc_off') {
      const rawUid = typeof payload?.uid === 'string' ? payload.uid.trim() : '';
      let uid = rawUid;
      if (!uid) {
        if (command === 'nfc_on') {
          setSimulatedNfc({
            uid: '',
            known: false,
            hardwareUid: generateHardwareUid(),
            at: Date.now(),
          });
          setScanTagLabel('');
          setScanMediaPath('');
          if (!scanTagUid) {
            setScanTagUid(generateTagId());
          }
          setTagUidMode('new');
          setTagStep(0);
          setTagStepOneDone(false);
          setTagStepTwoDone(false);
          return;
        }
        setError('Bitte eine UID angeben.');
        addToast('error', 'Bitte eine UID angeben.');
        return;
      }
      nextPayload = { ...payload, uid };
      if (command === 'nfc_on') {
        setLastHardwareUid({ uid, hardwareUid: generateHardwareUid() });
        setSimulatedNfc(null);
      }
    }
    const response = await sendCommand(selectedId, command, nextPayload);
    if (!response.ok) {
      setError(response.data.detail || 'Command fehlgeschlagen.');
      addToast('error', response.data.detail || 'Command fehlgeschlagen.');
      return;
    }
    setError('');
    addToast('success', 'Command gesendet.');
  }

  async function handlePlayerCommand(command, payload = {}) {
    if (!selectedId) {
      return;
    }
    let nextPayload = payload;
    if (command === 'nfc_on' || command === 'nfc_off') {
      const rawUid = typeof payload?.uid === 'string' ? payload.uid.trim() : '';
      const uid = rawUid;
      if (!uid) {
        if (command === 'nfc_on') {
          setSimulatedNfc({
            uid: '',
            known: false,
            hardwareUid: generateHardwareUid(),
            at: Date.now(),
          });
          setScanTagLabel('');
          setScanMediaPath('');
          if (!scanTagUid) {
            setScanTagUid(generateTagId());
          }
          setTagUidMode('new');
          setTagStep(0);
          setTagStepOneDone(false);
          setTagStepTwoDone(false);
          setTagStepMax(0);
        } else if (command === 'nfc_off') {
          setSimulatedNfc(null);
          setScanTagUid('');
          setScanTagLabel('');
          setScanMediaPath('');
          setLastHardwareUid({ uid: '', hardwareUid: '' });
          setTagUidMode('keep');
          setTagStep(0);
          setTagStepOneDone(false);
          setTagStepTwoDone(false);
          setTagStepMax(0);
        }
        return;
      }
      if (command === 'nfc_on') {
        setLastHardwareUid({ uid, hardwareUid: generateHardwareUid() });
        setSimulatedNfc(null);
      }
      nextPayload = { ...payload, uid };
    }
    await sendCommand(selectedId, command, nextPayload);
  }

  async function handleUnpair(boxId) {
    const response = await unpairBox(boxId);
    if (!response.ok) {
      setError(response.data.detail || 'Unpair fehlgeschlagen.');
      addToast('error', response.data.detail || 'Unpair fehlgeschlagen.');
      return;
    }
    addToast('success', 'Box unpaired.');
    const updated = await getBoxes();
    if (updated.ok) {
      setBoxes(updated.data.boxes || []);
    }
  }

  async function handleMediaRefresh() {
    const response = await getMediaTree();
    if (!response.ok) {
      setMediaError(response.data.detail || 'Medien nicht verfuegbar.');
      setMediaTree(null);
      return;
    }
    setMediaTree(response.data);
    setMediaError('');
  }

  function getNodeByPath(node, targetPath) {
    if (!node) return null;
    if ((node.path || '') === targetPath) return node;
    if (!Array.isArray(node.children)) return null;
    for (const child of node.children) {
      const found = getNodeByPath(child, targetPath);
      if (found) return found;
    }
    return null;
  }

  function listChildren(node) {
    if (!node) return [];
    if (!Array.isArray(node.children)) return [];
    return node.children;
  }

  function buildBreadcrumb(pathValue) {
    if (!pathValue) return [];
    const parts = pathValue.split('/').filter(Boolean);
    return parts.map((part, index) => ({
      name: part,
      path: parts.slice(0, index + 1).join('/'),
    }));
  }

  function collectTopLevelFolders(node) {
    if (!node || !Array.isArray(node.children)) return [];
    return node.children
      .filter((child) => child.type === 'folder')
      .map((child) => child.path);
  }

  function collectFolderPaths(node) {
    if (!node || node.type !== 'folder') return [];
    const entries = [node.path || ''];
    if (!Array.isArray(node.children)) return entries;
    node.children.forEach((child) => {
      if (child.type !== 'folder') return;
      entries.push(...collectFolderPaths(child));
    });
    return entries;
  }

  function isSelected(pathValue) {
    return selectedPaths.includes(pathValue || '');
  }

  async function handleCreateFolder() {
    const trimmedName = newFolderName.trim();
    if (uploadAfterCreate && pendingUploadFiles.length > 0) {
      if (!trimmedName && !currentPath) {
        addToast('error', 'Im Medien-Hauptordner ist ein Ordnername erforderlich.');
        setUploadNameError('Im Medien-Hauptordner ist ein Ordnername erforderlich.');
        return;
      }
      const targetPath = trimmedName ? `${currentPath}/${trimmedName}` : currentPath;
      setUploadInProgress(true);
      setActiveUploadLabel(
        pendingUploadFiles.length ? `Upload: ${pendingUploadFiles.length} Datei(en)` : ''
      );
      const uploadResponse = await uploadMedia(
        targetPath,
        pendingUploadFiles,
        (percent) => setUploadProgress(percent)
      );
      setUploadInProgress(false);
      setUploadProgress(0);
      if (!uploadResponse.ok) {
        setMediaError(uploadResponse.data.detail || 'Upload fehlgeschlagen.');
        addToast('error', uploadResponse.data.detail || 'Upload fehlgeschlagen.');
        return;
      }
      addToast('success', 'Upload abgeschlossen.');
      await handleMediaRefresh();
      setActiveModal('');
      setUploadAfterCreate(false);
      setPendingUploadFiles([]);
      setNewFolderName('');
      return;
    }

    if (!trimmedName && !uploadAfterCreate) {
      setMediaError('Bitte einen Ordnernamen angeben.');
      return;
    }

    const response = await createMediaFolder(currentPath, trimmedName);
    if (!response.ok) {
      setMediaError(response.data.detail || 'Ordner anlegen fehlgeschlagen.');
      addToast('error', response.data.detail || 'Ordner anlegen fehlgeschlagen.');
      return;
    }
    addToast('success', 'Ordner angelegt.');
    setNewFolderName('');
    setActiveModal('');
    await handleMediaRefresh();
  }

  async function handleRename() {
    if (!selectedPaths.length) return;
    const response = await renameMedia(selectedPaths[0], renameName.trim());
    if (!response.ok) {
      setMediaError(response.data.detail || 'Umbenennen fehlgeschlagen.');
      addToast('error', response.data.detail || 'Umbenennen fehlgeschlagen.');
      return;
    }
    addToast('success', 'Eintrag umbenannt.');
    setRenameName('');
    setActiveModal('');
    await handleMediaRefresh();
  }

  async function handleDeleteSelected() {
    if (!selectedPaths.length) return;
    for (const pathValue of selectedPaths) {
      const response = await deleteMedia(pathValue);
      if (!response.ok) {
        setMediaError(response.data.detail || 'Loeschen fehlgeschlagen.');
        addToast('error', response.data.detail || 'Loeschen fehlgeschlagen.');
        return;
      }
    }
    addToast('success', 'Eintraege geloescht.');
    setSelectedPaths([]);
    setActiveModal('');
    await handleMediaRefresh();
  }

  async function handleMoveSelected() {
    if (!selectedPaths.length) return;
    const pathValue = selectedPaths[0];
    const isRootTarget = moveTarget === '__root__' || moveTarget === '';
    const response = await moveMedia(pathValue, isRootTarget ? '' : moveTarget);
    if (!response.ok) {
      setMediaError(response.data.detail || 'Verschieben fehlgeschlagen.');
      addToast('error', response.data.detail || 'Verschieben fehlgeschlagen.');
      return;
    }
    addToast('success', 'Eintrag verschoben.');
    setMoveTarget('');
    setSelectedPaths([]);
    setActiveModal('');
    await handleMediaRefresh();
  }

  async function handleUpload(event) {
    const files = Array.from(event.target.files || []);
    const audioFiles = files.filter((file) => file.type.startsWith('audio/'));
    if (!audioFiles.length) return;
    if (!currentPath) {
      addToast('error', 'Im Medien-Hauptordner ist ein Ordnername erforderlich.');
      setUploadNameError('Im Medien-Hauptordner ist ein Ordnername erforderlich.');
      return;
    }
    setUploadInProgress(true);
    setActiveUploadLabel(
      audioFiles.length ? `Upload: ${audioFiles.length} Datei(en)` : ''
    );
    const response = await uploadMedia(currentPath, audioFiles, (percent) =>
      setUploadProgress(percent)
    );
    setUploadInProgress(false);
    setUploadProgress(0);
    if (!response.ok) {
      setMediaError(response.data.detail || 'Upload fehlgeschlagen.');
      addToast('error', response.data.detail || 'Upload fehlgeschlagen.');
      return;
    }
    addToast('success', 'Upload abgeschlossen.');
    await handleMediaRefresh();
  }

  const fileHeaderTemplate = (options) => {
    const { className, chooseButton, cancelButton } = options;
    return (
      <div className={className} style={{ backgroundColor: 'transparent', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {chooseButton}
        {cancelButton}
      </div>
    );
  };

  const fileItemTemplate = (file, props) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%', padding: '0.5rem 0', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
      <Button
        icon="pi pi-times"
        severity="danger"
        text
        rounded
        aria-label="Entfernen"
        onClick={() => {
          setUploadSize((prev) => Math.max(0, prev - file.size));
          setPendingUploadFiles((prev) =>
            prev.filter((entry) => entry.name !== file.name)
          );
          props.onRemove(file);
        }}
      />
      <div className="upload-item-meta">
        <strong className="upload-item-name">{file.name}</strong>
        <small className="upload-item-size">{formatSize(file.size)}</small>
      </div>
    </div>
  );

  const fileEmptyTemplate = () => (
    <div className="upload-item-footer">
      <span className="upload-item-total">Gesamt: {formatSize(uploadSize)}</span>
    </div>
  );

  function handleSelect(item, event) {
    const itemPath = item.path || '';
    if (event.shiftKey && lastAnchorRef.current) {
      const items = listChildren(getNodeByPath(mediaTree, currentPath));
      const anchorIndex = items.findIndex((entry) => entry.path === lastAnchorRef.current);
      const currentIndex = items.findIndex((entry) => entry.path === itemPath);
      if (anchorIndex !== -1 && currentIndex !== -1) {
        const [start, end] = anchorIndex < currentIndex
          ? [anchorIndex, currentIndex]
          : [currentIndex, anchorIndex];
        const range = items.slice(start, end + 1).map((entry) => entry.path || '');
        setSelectedPaths(Array.from(new Set([...selectedPaths, ...range])));
        return;
      }
    }
    if (event.metaKey || event.ctrlKey) {
      setSelectedPaths((prev) =>
        prev.includes(itemPath)
          ? prev.filter((pathValue) => pathValue !== itemPath)
          : [...prev, itemPath]
      );
      lastAnchorRef.current = itemPath;
      return;
    }
    const now = Date.now();
    const isDoubleClick = now - lastDblClickRef.current < 250;
    if (!isDoubleClick) {
      setSelectedPaths([itemPath]);
      lastAnchorRef.current = itemPath;
    }
  }

  function handleDragSelect(item) {
    if (!dragSelectRef.current) return;
    const itemPath = item.path || '';
    setSelectedPaths((prev) =>
      prev.includes(itemPath) ? prev : [...prev, itemPath]
    );
  }

  function handleOpen(item) {
    if (item.type !== 'folder') return;
    setCurrentPath(item.path || '');
    setSelectedPaths([]);
    setRenameName('');
    const key = item.path || '__root__';
    setExpandedFolders((prev) => new Set(prev).add(key));
  }

  function handleGoUp() {
    if (!currentPath) return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const next = parts.join('/');
    setCurrentPath(next);
    setSelectedPaths([]);
    setRenameName('');
  }

  function toggleFolder(pathValue) {
    const key = pathValue || '__root__';
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function renderFolderTree(node, depth = 0) {
    if (!node || node.type !== 'folder') return null;
    const isActive = (node.path || '') === currentPath;
    const key = node.path || '__root__';
    const isExpanded = expandedFolders.has(key);
    const childFolders =
      Array.isArray(node.children) && node.children.filter((child) => child.type === 'folder');
    const hasChildren = childFolders && childFolders.length > 0;
    const tagCount = mediaTagCounts[node.path || ''] || 0;
    return (
      <div key={node.path || 'root'} className={`tree-node depth-${depth}`}>
        <div
          className={`tree-row folder ${isActive ? 'active' : ''}`}
          onClick={() => handleOpen(node)}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleOpen(node);
          }}
        >
          {hasChildren ? (
            <div
              className="tree-caret"
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                toggleFolder(node.path || '');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.stopPropagation();
                  toggleFolder(node.path || '');
                }
              }}
              aria-label="Toggle"
            >
              {isExpanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
            </div>
          ) : (
            <span className="tree-caret disabled" aria-hidden="true" />
          )}
          <span className="tree-icon folder">
            <Folder size={16} weight="fill" />
          </span>
          <span className="tree-label">{node.name}</span>
          {tagCount > 0 && (
            <span className="tree-tag-count" aria-label={`Zugewiesene Tags: ${tagCount}`}>
              {tagCount}
            </span>
          )}
        </div>
        {isExpanded &&
          hasChildren &&
          childFolders.map((child) => renderFolderTree(child, depth + 1))}
      </div>
    );
  }

  async function handleClaimTagForScan() {
    setTagUidError('');
    const currentUid = scanTagUid.trim();
    const existing = tags.find((tag) => tag.uid === currentUid);
    if (existing) {
      if (existing.status === 'NEW') {
        const written = await markTagWritten(currentUid);
        if (!written.ok) {
          if (written.data.detail === 'invalid uid') {
            setTagUidError(
              'UID ungueltig. Bitte 10 Zeichen (a-z, 0-9) oder TAG_ + 8 Zeichen verwenden.'
            );
            return;
          }
          setError(written.data.detail || 'Tag schreiben fehlgeschlagen.');
          addToast('error', written.data.detail || 'Tag schreiben fehlgeschlagen.');
          return;
        }
      }
    } else {
      const response = await claimTag(currentUid, scanTagLabel.trim());
      if (!response.ok) {
        if (response.data.detail === 'invalid uid') {
          setTagUidError(
            'UID ungueltig. Bitte 10 Zeichen (a-z, 0-9) oder TAG_ + 8 Zeichen verwenden.'
          );
          return;
        }
        setError(response.data.detail || 'Tag schreiben fehlgeschlagen.');
        addToast('error', response.data.detail || 'Tag schreiben fehlgeschlagen.');
        return;
      }
      setScanTagUid(response.data.uid || '');
    }
    setError('');
    addToast('success', 'Tag geschrieben.');
    if (activeNfc) {
      setDismissedNfcKey(getNfcKey(activeNfc));
    }
    const shouldAssign =
      selectedId && status?.last_nfc?.known === false && scanMediaPath;
    if (shouldAssign) {
      const mediaSet = await setTagMedia(currentUid, scanMediaPath);
      if (!mediaSet.ok) {
        setError(mediaSet.data.detail || 'Medium setzen fehlgeschlagen.');
        addToast('error', mediaSet.data.detail || 'Medium setzen fehlgeschlagen.');
        return;
      }
      const assigned = await assignTag(currentUid, selectedId);
      if (!assigned.ok) {
        setError(assigned.data.detail || 'Zuordnung fehlgeschlagen.');
        addToast('error', assigned.data.detail || 'Zuordnung fehlgeschlagen.');
        return;
      }
      addToast('success', 'Tag zugeordnet.');
      if (activeNfc?.known === false) {
        await handlePlayerCommand('nfc_on', { uid: currentUid });
      }
      setScanTagUid('');
      setScanTagLabel('');
      setScanMediaPath('');
      setSimulatedNfc(null);
      setLastHardwareUid({ uid: '', hardwareUid: '' });
    } else if (selectedId && status?.last_nfc?.known === false) {
      addToast('success', 'Tag gespeichert. Medium fehlt noch.');
      setSimulatedNfc(null);
      setLastHardwareUid({ uid: '', hardwareUid: '' });
    }
    const updated = await getTags();
    if (updated.ok) {
      setTags(updated.data.tags || []);
    }
    if (selectedId) {
      const updatedBoxTags = await getBoxTags(selectedId);
      if (updatedBoxTags.ok) {
        setBoxTags(updatedBoxTags.data.tags || []);
      }
    }
  }

  async function handleReuseImportedTag() {
    if (!reuseTagUid) {
      setError('Bitte eine gespeicherte Tag-ID waehlen.');
      addToast('error', 'Bitte eine gespeicherte Tag-ID waehlen.');
      return;
    }
    if (!selectedId) {
      setError('Bitte zuerst eine Box auswaehlen.');
      addToast('error', 'Bitte zuerst eine Box auswaehlen.');
      return;
    }
    const tag = tags.find((entry) => entry.uid === reuseTagUid);
    if (!tag || !tag.media_path) {
      setError('Tag hat keine Medienzuordnung.');
      addToast('error', 'Tag hat keine Medienzuordnung.');
      return;
    }
    const response = await markTagWritten(reuseTagUid);
    if (!response.ok) {
      setError(response.data.detail || 'Tag schreiben fehlgeschlagen.');
      addToast('error', response.data.detail || 'Tag schreiben fehlgeschlagen.');
      return;
    }
    const assigned = await assignTag(reuseTagUid, selectedId);
    if (!assigned.ok) {
      setError(assigned.data.detail || 'Zuordnung fehlgeschlagen.');
      addToast('error', assigned.data.detail || 'Zuordnung fehlgeschlagen.');
      return;
    }
    addToast('success', 'Tag geschrieben und zugeordnet.');
    const updated = await getTags();
    if (updated.ok) {
      setTags(updated.data.tags || []);
    }
    const updatedBoxTags = await getBoxTags(selectedId);
    if (updatedBoxTags.ok) {
      setBoxTags(updatedBoxTags.data.tags || []);
    }
    setScanTagUid(reuseTagUid);
    setReuseTagUid('');
  }

  async function handleWriteTag(uid) {
    const response = await markTagWritten(uid);
    if (!response.ok) {
      setError(response.data.detail || 'Tag schreiben fehlgeschlagen.');
      addToast('error', response.data.detail || 'Tag schreiben fehlgeschlagen.');
      return;
    }
    addToast('success', 'Tag geschrieben.');
    const updated = await getTags();
    if (updated.ok) {
      setTags(updated.data.tags || []);
    }
  }

  async function handleStoreTagOnly() {
    if (!activeNfc?.uid) {
      setError('Keine UID erkannt.');
      addToast('error', 'Keine UID erkannt.');
      return;
    }
    const existing = tags.find((tag) => tag.uid === activeNfc.uid);
    if (existing) {
      addToast('success', 'Tag ist bereits in der Datenbank.');
      if (activeNfc) {
        setDismissedNfcKey(getNfcKey(activeNfc));
      }
      return;
    }
    const response = await claimTag(activeNfc.uid, '');
    if (!response.ok) {
      setError(response.data.detail || 'Tag speichern fehlgeschlagen.');
      addToast('error', response.data.detail || 'Tag speichern fehlgeschlagen.');
      return;
    }
    addToast('success', 'Tag in der Datenbank gespeichert.');
    if (activeNfc) {
      setDismissedNfcKey(getNfcKey(activeNfc));
    }
    setSimulatedNfc(null);
    setLastHardwareUid({ uid: '', hardwareUid: '' });
    const updated = await getTags();
    if (updated.ok) {
      setTags(updated.data.tags || []);
    }
  }

  async function handleAssignFromScan() {
    if (!scanMediaPath) {
      setError('Bitte zuerst einen Medienordner waehlen.');
      addToast('error', 'Bitte zuerst einen Medienordner waehlen.');
      return;
    }
    const uid = scanTagUid.trim();
    if (!uid) {
      setError('Bitte zuerst eine Tag-ID schreiben.');
      addToast('error', 'Bitte zuerst eine Tag-ID schreiben.');
      return;
    }
    const matching = tags.find((tag) => tag.uid === uid);
    if (!matching) {
      setError('Tag-ID existiert nicht. Bitte zuerst schreiben.');
      addToast('error', 'Tag-ID existiert nicht. Bitte zuerst schreiben.');
      return;
    }
    const mediaSet = await setTagMedia(uid, scanMediaPath);
    if (!mediaSet.ok) {
      setError(mediaSet.data.detail || 'Medium setzen fehlgeschlagen.');
      addToast('error', mediaSet.data.detail || 'Medium setzen fehlgeschlagen.');
      return;
    }
    const assigned = await assignTag(uid, selectedId);
    if (!assigned.ok) {
      setError(assigned.data.detail || 'Zuordnung fehlgeschlagen.');
      addToast('error', assigned.data.detail || 'Zuordnung fehlgeschlagen.');
      return;
    }
    addToast('success', 'Tag zugeordnet.');
    if (activeNfc?.known === false) {
      await handlePlayerCommand('nfc_on', { uid });
    }
    if (activeNfc) {
      setDismissedNfcKey(getNfcKey(activeNfc));
    }
    setScanTagUid('');
    setScanTagLabel('');
    setScanMediaPath('');
    setSimulatedNfc(null);
    setLastHardwareUid({ uid: '', hardwareUid: '' });
    const updatedTags = await getTags();
    if (updatedTags.ok) {
      setTags(updatedTags.data.tags || []);
    }
    const updatedBoxTags = await getBoxTags(selectedId);
    if (updatedBoxTags.ok) {
      setBoxTags(updatedBoxTags.data.tags || []);
    }
  }

  async function handlePullTagFromBox() {
    if (!selectedId) {
      setError('Bitte zuerst eine Box auswaehlen.');
      addToast('error', 'Bitte zuerst eine Box auswaehlen.');
      return;
    }
    if (!importTargetUid) {
      setError('Kein Tag ausgewaehlt.');
      addToast('error', 'Kein Tag ausgewaehlt.');
      return;
    }
    const response = await pullTagFromBox(
      selectedId,
      importTargetUid,
      importTargetFolder.trim()
    );
    if (!response.ok) {
      setError(response.data.detail || 'Import fehlgeschlagen.');
      addToast('error', response.data.detail || 'Import fehlgeschlagen.');
      return;
    }
    addToast('success', 'Medien vom Box-Tag uebertragen.');
    setImportTargetUid('');
    setImportTargetFolder('');
    setActiveModal('');
    const updated = await getTags();
    if (updated.ok) {
      setTags(updated.data.tags || []);
    }
    const updatedLocal = await getBoxLocalTags(selectedId);
    if (updatedLocal.ok) {
      setLocalBoxTags(updatedLocal.data.tags || []);
    }
    await handleMediaRefresh();
  }

  async function handleUnassignTag(uid) {
    const response = await unassignTag(uid, selectedId);
    if (!response.ok) {
      setError(response.data.detail || 'Tag loesen fehlgeschlagen.');
      addToast('error', response.data.detail || 'Tag loesen fehlgeschlagen.');
      return;
    }
    addToast('success', 'Tag getrennt.');
    const updated = await getBoxTags(selectedId);
    if (updated.ok) {
      setBoxTags(updated.data.tags || []);
    }
  }

  async function handleDeleteTag(uid) {
    const response = await deleteTag(uid);
    if (!response.ok) {
      setError(response.data.detail || 'Tag loeschen fehlgeschlagen.');
      addToast('error', response.data.detail || 'Tag loeschen fehlgeschlagen.');
      return;
    }
    addToast('success', 'Tag geloescht.');
    const updatedTags = await getTags();
    if (updatedTags.ok) {
      setTags(updatedTags.data.tags || []);
    }
    if (selectedId) {
      const updatedBoxTags = await getBoxTags(selectedId);
      if (updatedBoxTags.ok) {
        setBoxTags(updatedBoxTags.data.tags || []);
      }
    }
    if (boxes.length) {
      const results = await Promise.all(
        boxes.map(async (box) => ({
          boxId: box.box_id,
          response: await getTagBlocks(box.box_id),
        }))
      );
      const next = {};
      results.forEach(({ boxId, response }) => {
        if (response.ok) {
          next[boxId] = response.data.blocked || [];
        }
      });
      setBlockedByBox(next);
    }
  }

  async function handleSetTagMedia(uid) {
    const mediaPath = dbTagMedia[uid] || '';
    const response = await setTagMedia(uid, mediaPath);
    if (!response.ok) {
      setError(response.data.detail || 'Medium setzen fehlgeschlagen.');
      addToast('error', response.data.detail || 'Medium setzen fehlgeschlagen.');
      return;
    }
    const lastNfcUid = status?.last_nfc?.uid || '';
    const shouldAssign =
      selectedId &&
      status?.last_nfc?.known === false &&
      (lastNfcUid === uid || (!lastNfcUid && scanTagUid && scanTagUid === uid));
    if (shouldAssign) {
      const assigned = await assignTag(uid, selectedId);
      if (!assigned.ok) {
        setError(assigned.data.detail || 'Zuordnung fehlgeschlagen.');
        addToast('error', assigned.data.detail || 'Zuordnung fehlgeschlagen.');
        return;
      }
      addToast('success', 'Medium gespeichert und Tag zugeordnet.');
    } else {
      addToast('success', 'Medium gespeichert.');
    }
    const updatedTags = await getTags();
    if (updatedTags.ok) {
      setTags(updatedTags.data.tags || []);
    }
    if (selectedId) {
      const updatedBoxTags = await getBoxTags(selectedId);
      if (updatedBoxTags.ok) {
        setBoxTags(updatedBoxTags.data.tags || []);
      }
    }
    if (boxes.length) {
      const results = await Promise.all(
        boxes.map(async (box) => ({
          boxId: box.box_id,
          response: await getTagBlocks(box.box_id),
        }))
      );
      const next = {};
      results.forEach(({ boxId, response }) => {
        if (response.ok) {
          next[boxId] = response.data.blocked || [];
        }
      });
      setBlockedByBox(next);
    }
  }

  async function handleClearTagMedia(uid) {
    const response = await setTagMedia(uid, '');
    if (!response.ok) {
      setError(response.data.detail || 'Medium entfernen fehlgeschlagen.');
      addToast('error', response.data.detail || 'Medium entfernen fehlgeschlagen.');
      return;
    }
    setError('');
    addToast('success', 'Medienzuweisung entfernt.');
    setDbTagMedia((prev) => ({ ...prev, [uid]: '' }));
    const updatedTags = await getTags();
    if (updatedTags.ok) {
      setTags(updatedTags.data.tags || []);
    }
    if (selectedId) {
      const updatedBoxTags = await getBoxTags(selectedId);
      if (updatedBoxTags.ok) {
        setBoxTags(updatedBoxTags.data.tags || []);
      }
    }
    if (boxes.length) {
      const results = await Promise.all(
        boxes.map(async (box) => ({
          boxId: box.box_id,
          response: await getTagBlocks(box.box_id),
        }))
      );
      const next = {};
      results.forEach(({ boxId, response }) => {
        if (response.ok) {
          next[boxId] = response.data.blocked || [];
        }
      });
      setBlockedByBox(next);
    }
  }

  async function handleToggleTagBlock(boxId, uid, nextBlocked) {
    const response = await setTagBlock(boxId, uid, nextBlocked);
    if (!response.ok) {
      addToast('error', response.data.detail || 'Tag-Sperre fehlgeschlagen.');
      return;
    }
    setBlockedByBox((prev) => {
      const current = new Set(prev[boxId] || []);
      if (nextBlocked) {
        current.add(uid);
      } else {
        current.delete(uid);
      }
      return { ...prev, [boxId]: Array.from(current) };
    });
    addToast(
      'success',
      nextBlocked ? 'Tag gesperrt.' : 'Tag freigegeben.'
    );
  }

  async function handleSaveTagAlias(uid) {
    const value = (tagAliasDrafts[uid] ?? '').trim();
    const response = await setTagAlias(uid, value || null);
    if (!response.ok) {
      addToast('error', response.data.detail || 'Tag-Alias speichern fehlgeschlagen.');
      return;
    }
    const updated = await getTags();
    if (updated.ok) {
      setTags(updated.data.tags || []);
    }
    addToast('success', 'Tag-Alias gespeichert.');
  }

  async function handleSaveBoxAlias(boxId) {
    const value = (boxAliasDrafts[boxId] ?? '').trim();
    const response = await setBoxAlias(boxId, value || null);
    if (!response.ok) {
      addToast('error', response.data.detail || 'Box-Alias speichern fehlgeschlagen.');
      return;
    }
    const updated = await getBoxes();
    if (updated.ok) {
      setBoxes(updated.data.boxes || []);
    }
    addToast('success', 'Box-Alias gespeichert.');
  }

  const currentItems = mediaTree
    ? listChildren(getNodeByPath(mediaTree, currentPath)).filter(
      (item) => !(item.name || '').startsWith('.')
    )
    : [];
  const showMeta = currentItems.some((item) => item.type === 'file');
  const mediaBytes = mediaTree?.size ?? null;
  const freeBytes = mediaTree?.free_bytes ?? null;
  const systemStorage = useMemo(() => {
    if (!mediaTree || mediaTree.size === undefined || mediaTree.free_bytes === undefined) {
      return null;
    }
    const used = Math.max(0, mediaTree.size || 0);
    const free = Math.max(0, mediaTree.free_bytes || 0);
    const total = used + free;
    const percent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
    return { used, free, total, percent, scale: capacityScale(percent) };
  }, [mediaTree]);

  const activeMeta = useMemo(
    () => NAV_ITEMS.find((item) => item.id === activeSection),
    [activeSection]
  );
  const activeBoxLabel = useMemo(() => {
    const activeBox = boxes.find((box) => box.box_id === selectedId);
    return activeBox?.alias || activeBox?.box_id || '';
  }, [boxes, selectedId]);
  const activeNfc = useMemo(() => {
    if (status?.last_nfc && status.last_nfc.known === false) {
      return { ...status.last_nfc, at: status.last_nfc_at };
    }
    return simulatedNfc;
  }, [status, simulatedNfc]);

  const activeNfcKey = useMemo(
    () => (activeNfc ? getNfcKey(activeNfc) : ''),
    [activeNfc]
  );

  useEffect(() => {
    if (!activeNfcKey) return;
    if (tagWizardRestoredRef.current === activeNfcKey) return;
    try {
      const raw = sessionStorage.getItem('klangkiste_tag_wizard');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.key !== activeNfcKey) return;
      const data = parsed.data || {};
      if (typeof data.scanTagUid === 'string') setScanTagUid(data.scanTagUid);
      if (typeof data.scanTagLabel === 'string') setScanTagLabel(data.scanTagLabel);
      if (typeof data.scanMediaPath === 'string') setScanMediaPath(data.scanMediaPath);
      if (typeof data.tagUidMode === 'string') setTagUidMode(data.tagUidMode);
      if (typeof data.tagStep === 'number') setTagStep(data.tagStep);
      setTagStepOneDone(Boolean(data.tagStepOneDone));
      setTagStepTwoDone(Boolean(data.tagStepTwoDone));
      if (typeof data.tagStepMax === 'number') setTagStepMax(data.tagStepMax);
      if (typeof data.tagUidError === 'string') setTagUidError(data.tagUidError);
      if (data.lastHardwareUid?.uid || data.lastHardwareUid?.hardwareUid) {
        setLastHardwareUid(data.lastHardwareUid);
      }
      if (!status?.last_nfc && data.simulatedNfc) {
        setSimulatedNfc(data.simulatedNfc);
      }
      if (typeof data.dismissedNfcKey === 'string') {
        setDismissedNfcKey(data.dismissedNfcKey);
      }
      tagWizardRestoredRef.current = activeNfcKey;
    } catch (error) {
      // ignore storage restore errors
    }
  }, [activeNfcKey, status?.last_nfc]);

  useEffect(() => {
    if (!activeNfcKey) return;
    try {
      const payload = {
        key: activeNfcKey,
        data: {
          scanTagUid,
          scanTagLabel,
          scanMediaPath,
          tagUidMode,
          tagStep,
          tagStepOneDone,
          tagStepTwoDone,
          tagStepMax,
          tagUidError,
          lastHardwareUid,
          simulatedNfc,
          dismissedNfcKey,
        },
      };
      sessionStorage.setItem('klangkiste_tag_wizard', JSON.stringify(payload));
    } catch (error) {
      // ignore storage write errors
    }
  }, [
    activeNfcKey,
    scanTagUid,
    scanTagLabel,
    scanMediaPath,
    tagUidMode,
    tagStep,
    tagStepOneDone,
    tagStepTwoDone,
    tagStepMax,
    tagUidError,
    lastHardwareUid,
    simulatedNfc,
    dismissedNfcKey,
  ]);
  const statusWithHardware = useMemo(() => {
    if (!status) return null;
    const hardwareUid =
      lastHardwareUid.uid === status?.last_nfc?.uid && lastHardwareUid.hardwareUid
        ? lastHardwareUid.hardwareUid
        : activeNfc?.hardwareUid || null;
    if (!status.last_nfc) return status;
    return {
      ...status,
      last_nfc: {
        ...status.last_nfc,
        hardware_uid: hardwareUid,
      },
    };
  }, [status, lastHardwareUid, activeNfc]);
  const activeTag = useMemo(() => {
    const uid = status?.last_nfc?.uid || activeNfc?.uid || '';
    if (!uid) return null;
    return tags.find((tag) => tag.uid === uid) || null;
  }, [status, activeNfc, tags]);
  const playlistRoot = activeTag?.media_path || '';
  const playlistTitle = playlistRoot ? playlistRoot.split('/').filter(Boolean).pop() : '';
  const playlistItems = useMemo(() => {
    if (!mediaTree || !playlistRoot) return [];
    const node = getNodeByPath(mediaTree, playlistRoot);
    if (!node) return [];
    const stack = [node];
    const collected = [];
    while (stack.length) {
      const current = stack.pop();
      if (!current) continue;
      if (current.type === 'file') {
        collected.push(current);
        continue;
      }
      if (Array.isArray(current.children)) {
        for (let i = current.children.length - 1; i >= 0; i -= 1) {
          stack.push(current.children[i]);
        }
      }
    }
    return collected;
  }, [mediaTree, playlistRoot]);
  const playlistDuration = useMemo(() => {
    if (!playlistItems.length) return 0;
    return playlistItems.reduce((sum, item) => sum + (item.duration || 0), 0);
  }, [playlistItems]);
  const playbackState = status?.playback_state || {};
  const currentIndex =
    typeof playbackState.file_index === 'number' ? playbackState.file_index : null;
  const currentTrack =
    currentIndex !== null && playlistItems[currentIndex]
      ? playlistItems[currentIndex]
      : null;
  const currentTitle =
    currentTrack?.title ||
    currentTrack?.name ||
    (playbackState.current_file
      ? playbackState.current_file.split('/').pop()
      : '');
  const currentArtist = currentTrack?.artist || '';
  const playbackPosition =
    typeof playbackState.position === 'number' ? playbackState.position : 0;
  const playbackDuration =
    typeof playbackState.duration === 'number' ? playbackState.duration : 0;
  const playbackProgress =
    playbackDuration > 0
      ? Math.min(100, Math.round((playbackPosition / playbackDuration) * 100))
      : 0;
  const isPlaying = playbackState.state === 'PLAYING';
  const volumeValue =
    typeof playbackState.volume === 'number' ? playbackState.volume : null;

  function handleSeekCommit(percent) {
    if (!playbackDuration) return;
    const targetSeconds = Math.round((percent / 100) * playbackDuration);
    handlePlayerCommand('seek', { position: targetSeconds });
  }

  function handleVolumeCommit(nextValue) {
    handlePlayerCommand('set_volume', { volume: nextValue });
  }

  useEffect(() => {
    if (isSeeking) return;
    setSeekPercent(playbackProgress);
  }, [playbackProgress, isSeeking]);

  useEffect(() => {
    setIsSeeking(false);
    setSeekPercent(playbackProgress);
  }, [currentIndex, playbackProgress]);

  useEffect(() => {
    setVolumeDraft(volumeValue ?? 50);
  }, [volumeValue]);

  useEffect(() => {
    if (!showVolume) return;
    function handleOutside(event) {
      if (!volumeRef.current) return;
      if (volumeRef.current.contains(event.target)) return;
      setShowVolume(false);
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [showVolume]);

  function renderSection() {
    if (activeSection === 'dashboard') {
      return (
        <div className="section-stack">
          <StatGrid items={dashboardStats} />
          <div className="split-grid">
            <Card className="wide-card">
              <h3>Live-Status</h3>
              {!selectedId && <p className="muted">Waehle eine gepairte Box aus.</p>}
              {selectedId && !status && <p className="muted">Status wird geladen...</p>}
              {status && status.error && <p className="error">{status.error}</p>}
              {status && !status.error && (
                <pre className="status">{JSON.stringify(statusWithHardware, null, 2)}</pre>
              )}
            </Card>
            <Card className="wide-card">
              <div className="player-shell">
                <div className="player-header">
                  <div className="player-cover" />
                  <div className="player-meta">
                    <h3>{currentTitle || playlistTitle || 'Playlist'}</h3>
                    <p>{currentArtist || playlistRoot || 'Kein Medium zugeordnet'}</p>
                    <div className="player-sub">
                      <span>{playlistItems.length} Tracks</span>
                      <span>{formatClock(playlistDuration)}</span>
                    </div>
                  </div>
                  <div className="player-controls">
                    <Button
                      className="player-btn"
                      icon="pi pi-step-backward"
                      onClick={() => handlePlayerCommand('prev')}
                      aria-label="Zurueck"
                    />
                    <Button
                      className="player-btn primary"
                      icon={isPlaying ? 'pi pi-pause' : 'pi pi-play'}
                      onClick={() => handlePlayerCommand('play_pause')}
                      aria-label={isPlaying ? 'Pause' : 'Play'}
                    />
                    <Button
                      className="player-btn"
                      icon="pi pi-step-forward"
                      onClick={() => handlePlayerCommand('next')}
                      aria-label="Weiter"
                    />
                    <Button
                      className="player-btn"
                      icon="pi pi-stop"
                      onClick={() => handlePlayerCommand('stop')}
                      aria-label="Stopp"
                    />
                    <div className="volume-wrap" ref={volumeRef}>
                      <Button
                        className="player-btn"
                        icon="pi pi-volume-up"
                        onClick={() => setShowVolume((prev) => !prev)}
                        aria-label="Lautstaerke"
                      />
                      {showVolume && (
                        <div className="volume-popover">
                          <Slider
                            orientation="vertical"
                            min={0}
                            max={100}
                            step={1}
                            value={volumeDraft}
                            onChange={(event) => {
                              setVolumeDraft(event.value ?? 0);
                            }}
                            onSlideEnd={(event) => {
                              handleVolumeCommit(event.value ?? 0);
                            }}
                          />
                          <span className="volume-label">{volumeDraft}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="player-progress">
                  <span>{formatClock(playbackPosition)}</span>
                  <Slider
                    value={seekPercent}
                    min={0}
                    max={100}
                    step={1}
                    onChange={(event) => {
                      setSeekPercent(event.value ?? 0);
                      setIsSeeking(true);
                    }}
                    onSlideEnd={(event) => {
                      setIsSeeking(false);
                      handleSeekCommit(event.value ?? 0);
                    }}
                  />
                  <span>{formatClock(playbackDuration)}</span>
                </div>
                <div className="player-nfc">
                  <InputText
                    value={nfcUid}
                    onChange={(event) => setNfcUid(event.target.value)}
                    placeholder="UID_1"
                    className="p-inputtext-sm"
                  />
                  <Button label="NFC on" onClick={() => handlePlayerCommand('nfc_on', { uid: nfcUid })} />
                  <Button label="NFC off" onClick={() => handlePlayerCommand('nfc_off', { uid: nfcUid })} />
                </div>
                <div className="player-list">
                  <div className="player-row header">
                    <span>#</span>
                    <span>Titel</span>
                    <span>Interpret</span>
                    <span>Dauer</span>
                  </div>
                  {playlistItems.length === 0 && (
                    <div className="player-row empty">
                      <span />
                      <span>Keine Playlist gefunden.</span>
                      <span />
                      <span />
                    </div>
                  )}
                  {playlistItems.map((track, index) => (
                    <div
                      key={track.path || track.name || index}
                      className={`player-row${currentIndex === index ? ' active' : ''}`}
                      onDoubleClick={(event) => {
                        event.preventDefault();
                        handlePlayerCommand('jump_to_index', { index });
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          handlePlayerCommand('jump_to_index', { index });
                        }
                      }}
                    >
                      <span>{index + 1}</span>
                      <span>{track.title || track.name}</span>
                      <span>{track.artist || '-'}</span>
                      <span>{formatClock(track.duration)}</span>
                    </div>
                  ))}
                </div>
                <p className="muted">
                  Steuerung ist nur moeglich, wenn die Box gepairt ist.
                </p>
              </div>
            </Card>
          </div>
        </div>
      );
    }

    if (activeSection === 'boxes') {
      return (
        <div className="section-stack legacy">
          {unpaired.length > 0 && (
            <Card className="panel-card">
              <h3>Neue Boxen</h3>
              {unpaired.map((box) => (
                <div key={box.box_id} className="card">
                  <div>
                    <strong>{box.alias || box.box_id}</strong>
                    <div className="meta">Zuletzt gesehen: {formatTime(box.last_seen)}</div>
                    <div className="meta">Firmware: {box.firmware_version}</div>
                    <div className="meta">ID: {box.box_id}</div>
                  </div>
                  <Button label="Pairen" onClick={() => handlePair(box.box_id)} />
                </div>
              ))}
            </Card>
          )}
          <Card className="panel-card">
            <h3>Gepairte Boxen</h3>
            {paired.length === 0 && <p className="muted">Noch keine gepairten Boxen.</p>}
            {paired.length > 0 && (
              <div className="boxes-grid">
                {paired.map((box) => (
                  <div
                    key={box.box_id}
                    className={`card ${selectedId === box.box_id ? 'selected' : ''}`}
                    onClick={() => setSelectedId(box.box_id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') setSelectedId(box.box_id);
                    }}
                  >
                    <div>
                <div className="box-title">
                  <strong>{box.alias || box.box_id}</strong>
                  <span className="pill">{getAvailability(box.last_seen).label}</span>
                </div>
                      <div className="meta">Zuletzt gesehen: {formatTime(box.last_seen)}</div>
                      <div className="meta">Capabilities: {parseCapabilities(box.capabilities_json)}</div>
                      <div className="meta">ID: {box.box_id}</div>
                    </div>
                    <div className="stack box-actions">
                      <div className="box-actions-row">
                        <InputText
                          className="alias-input p-inputtext-sm"
                          placeholder="Alias"
                          value={
                            boxAliasDrafts[box.box_id] !== undefined
                              ? boxAliasDrafts[box.box_id]
                              : box.alias || ''
                          }
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => {
                            event.stopPropagation();
                            setBoxAliasDrafts((prev) => ({
                              ...prev,
                              [box.box_id]: event.target.value,
                            }));
                          }}
                        />
                        <Button
                          className="icon-button"
                          icon={<FloppyDisk size={16} />}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleSaveBoxAlias(box.box_id);
                          }}
                          title="Alias speichern"
                          aria-label="Alias speichern"
                        />
                        <Button
                          className="icon-button"
                          icon={<ArrowRight size={16} />}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleShowBoxDetails(box.box_id);
                          }}
                          title="Details"
                          aria-label="Details"
                        />
                        <Button
                          className="icon-button danger"
                          icon={<Trash size={16} />}
                          onClick={(event) => {
                            event.stopPropagation();
                            setBoxDeleteTarget(box.box_id);
                          }}
                          title="Unpair"
                          aria-label="Unpair"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      );
    }

    if (activeSection === 'media') {
      return (
        <div className="section-stack legacy">
          <Card className="panel-card">
            <div className="panel-header">
              <h3>Medien Explorer</h3>
              <Button className="button-ghost" label="Refresh" onClick={handleMediaRefresh} />
            </div>
            {uploadInProgress && (
              <div className="upload-status">
                <span>{activeUploadLabel || 'Upload laeuft...'}</span>
                <div className="upload-progress">
                  <div style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
            )}
            <p className="muted">Ordnerverwaltung, Upload und Datei-Listen im Server-Medienordner.</p>
            {mediaError && <p className="error">{mediaError}</p>}
            {!mediaError && !mediaTree && <p className="muted">Medienliste wird geladen...</p>}
            {!mediaError && mediaTree && (
              <div className="explorer" ref={explorerRef}>
                <div className="explorer-sidebar">
                  <div className="explorer-toolbar sidebar-toolbar">
                      <InputText
                        className="sidebar-search p-inputtext-sm"
                        type="search"
                        placeholder="Suchen..."
                        value={sidebarQuery}
                        onChange={(event) => setSidebarQuery(event.target.value)}
                        aria-label="Ordner suchen"
                      />
                  </div>
                  <div className="sidebar-tree">
                    {topLevelFolders.length === 0 && (
                      <div className="muted">Keine Ordner gefunden.</div>
                    )}
                    {filteredTree && renderFolderTree(filteredTree, 0)}
                  </div>
                </div>
                <div className="explorer-main">
                  <div className="explorer-toolbar">
                    <Button
                      className="icon-button"
                      icon={<ArrowUp size={16} />}
                      onClick={handleGoUp}
                      title="Hoch"
                      aria-label="Hoch"
                    />
                    <div className="explorer-path">
                      <span
                        className="breadcrumb-root path-link"
                        onClick={() => setCurrentPath('')}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') setCurrentPath('');
                        }}
                      >
                        media
                      </span>
                      {buildBreadcrumb(currentPath).map((crumb) => (
                        <span
                          key={crumb.path}
                          className="path-link"
                          onClick={() => setCurrentPath(crumb.path)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') setCurrentPath(crumb.path);
                          }}
                        >
                          / {crumb.name}
                        </span>
                      ))}
                    </div>
                    <div className="toolbar-actions">
                      <Button
                        className="icon-button"
                        icon={<Plus size={16} />}
                        onClick={() => setActiveModal('new-folder')}
                        title="Neuer Ordner"
                        aria-label="Neuer Ordner"
                      />
                      <Button
                        className="icon-button"
                        icon={<PencilSimple size={16} />}
                        onClick={() => setActiveModal('rename')}
                        title="Umbenennen"
                        disabled={selectedPaths.length !== 1}
                        aria-label="Umbenennen"
                      />
                      <Button
                        className="icon-button danger"
                        icon={<Trash size={16} />}
                        onClick={() => setActiveModal('delete')}
                        title="Loeschen"
                        disabled={selectedPaths.length === 0}
                        aria-label="Loeschen"
                      />
                      <Button
                        className="icon-button"
                        icon={<ArrowRight size={16} />}
                        onClick={() => {
                          setMoveTarget('');
                          setActiveModal('move');
                        }}
                        title="Verschieben"
                        disabled={selectedPaths.length === 0}
                        aria-label="Verschieben"
                      />
                      <Button
                        className="icon-button upload"
                        icon={<UploadSimple size={16} />}
                        title="Upload"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setUploadAfterCreate(true);
                          setPendingUploadFiles([]);
                          setNewFolderName('');
                          setActiveModal('new-folder');
                        }}
                        aria-label="Upload"
                      />
                    </div>
                  </div>
                  <div className={`explorer-list ${showMeta ? 'has-meta' : ''}`}>
                    <div className="explorer-row header">
                      <span>Name</span>
                      {showMeta ? (
                        <>
                          <span>Interpret</span>
                          <span>Titel</span>
                          <span>Laenge</span>
                          <span>Groesse</span>
                        </>
                      ) : (
                        <>
                          <span>Typ</span>
                          <span>Groesse</span>
                        </>
                      )}
                    </div>
                    {currentItems.map((item) => (
                      <div
                        key={item.path || item.name}
                        className={`explorer-row ${
                          isSelected(item.path) ? 'selected' : ''
                        }`}
                        onMouseDown={(event) => {
                          if (event.button !== 0) return;
                          if (event.metaKey || event.ctrlKey || event.shiftKey) {
                            return;
                          }
                          dragSelectRef.current = true;
                          handleSelect(item, event);
                        }}
                        onMouseEnter={() => handleDragSelect(item)}
                        onClick={(event) => handleSelect(item, event)}
                        onDoubleClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          lastDblClickRef.current = Date.now();
                          handleOpen(item);
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') handleOpen(item);
                        }}
                      >
                        <span className="row-name">
                          <span className="row-icon">
                            {item.type === 'folder' ? (
                              <Folder size={16} weight="fill" />
                            ) : (
                              <FileAudio size={16} />
                            )}
                          </span>
                          {item.name}
                        </span>
                        {showMeta ? (
                          <>
                            <span>{item.type === 'folder' ? '-' : item.artist || '-'}</span>
                            <span>{item.type === 'folder' ? '-' : item.title || '-'}</span>
                            <span>
                              {item.type === 'folder' ? '-' : formatDuration(item.duration)}
                            </span>
                            <span>{formatSize(item.size)}</span>
                          </>
                        ) : (
                          <>
                            <span>{item.type === 'folder' ? 'Ordner' : 'Datei'}</span>
                            <span>{formatSize(item.size)}</span>
                          </>
                        )}
                      </div>
                    ))}
                    {selectedPaths.length > 0 && (
                      <div className="explorer-row footer">
                        <span />
                        {showMeta ? (
                          <>
                            <span />
                            <span />
                            <span />
                            <span className="footer-count">
                              {selectedPaths.length} ausgewaehlt
                            </span>
                          </>
                        ) : (
                          <>
                            <span />
                            <span className="footer-count">
                              {selectedPaths.length} ausgewaehlt
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="explorer-footer">
                  <span>
                    Medienordner: {formatSize(mediaBytes)} · Verfuegbar:{' '}
                    {formatSize(freeBytes)}
                  </span>
                </div>
              </div>
            )}
          </Card>
        </div>
      );
    }

    if (activeSection === 'tags') {
      return (
        <div className="section-stack legacy">
          {(localBoxError || localBoxTags.length > 0) && (
            <Card className="panel-card">
              <div className="panel-header">
                <h3>Tags nur auf dieser Box</h3>
              </div>
              {localBoxError && <p className="error">{localBoxError}</p>}
              {localBoxTags.map((tag) => (
                <div key={tag.uid} className="box-tag-row">
                  <div>
                    <strong>{tag.uid}</strong>
                    <div className="muted">
                      Dateien: {tag.file_count} · {formatSize(tag.total_size)}
                    </div>
                    {tag.media_exists && tag.files?.length > 0 && (
                      <ul className="file-list">
                        {tag.files.map((file) => (
                          <li key={file}>{file}</li>
                        ))}
                      </ul>
                    )}
                    {!tag.media_exists && (
                      <p className="muted">Keine Dateien im Box-Ordner gefunden.</p>
                    )}
                  </div>
                  <div className="box-tag-actions">
                    <Button
                      label="Auf Server uebertragen"
                      onClick={() => {
                        setImportTargetUid(tag.uid);
                        setActiveModal('import-tag');
                      }}
                      disabled={!tag.media_exists}
                    />
                  </div>
                </div>
              ))}
            </Card>
          )}

          <Card className="panel-card">
            <h3>Tags (Datenbank)</h3>
            {tags.length === 0 && <p className="muted">Keine Tags vorhanden.</p>}
            {tags.length > 0 && (
              <div className="tags-grid">
                {tags.map((tag) => (
                  <div key={tag.uid} className="card compact">
                    <div className="tag-row">
                      <div className="tag-info">
                        <strong>
                          {tag.alias ? `${tag.alias} (${tag.uid})` : tag.uid}
                        </strong>
                        <div className="meta">Status: {tag.status}</div>
                        <div className="meta">Medium: {tag.media_path || '-'}</div>
                        {tag.label ? <div className="meta">Label: {tag.label}</div> : null}
                      </div>
                      <div className="stack stack-inline tag-actions">
                        <div className="tag-actions-row">
                          <InputText
                            className="alias-input p-inputtext-sm"
                            placeholder="Alias"
                            value={
                              tagAliasDrafts[tag.uid] !== undefined
                                ? tagAliasDrafts[tag.uid]
                                : tag.alias || ''
                            }
                            onChange={(event) =>
                              setTagAliasDrafts((prev) => ({
                                ...prev,
                                [tag.uid]: event.target.value,
                              }))
                            }
                          />
                          <Button
                            className="icon-button"
                            icon={<FloppyDisk size={16} />}
                            onClick={() => handleSaveTagAlias(tag.uid)}
                            title="Alias speichern"
                            aria-label="Alias speichern"
                          />
                        </div>
                        <div className="tag-actions-row">
                          <Dropdown
                            value={dbTagMedia[tag.uid] ?? tag.media_path ?? null}
                            onChange={(event) =>
                              setDbTagMedia((prev) => ({
                                ...prev,
                                [tag.uid]: event.value,
                              }))
                            }
                            options={collectTopLevelFolders(mediaTree).map((folderPath) => ({
                              label: folderPath,
                              value: folderPath,
                            }))}
                            placeholder="Medienordner waehlen"
                            filter
                            className="p-inputtext-sm"
                          />
                          <Button
                            className="icon-button danger"
                            icon={<Trash size={16} />}
                            onClick={() => {
                              setTagDeleteTarget(tag.uid);
                              setActiveModal('tag-delete');
                            }}
                            title="Loeschen"
                            aria-label="Loeschen"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="panel-card">
            <h3>Tag-Matrix (Sperren)</h3>
            {paired.length === 0 && (
              <p className="muted">Keine gepairten Boxen vorhanden.</p>
            )}
            {tags.length === 0 && <p className="muted">Keine Tags vorhanden.</p>}
            {paired.length > 0 && tags.length > 0 && (
              <div className="tag-matrix">
                <div className="matrix-row header">
                  <span className="matrix-cell label">Tag</span>
                  {paired.map((box) => (
                    <span key={box.box_id} className="matrix-cell">
                      {box.alias || box.box_id}
                    </span>
                  ))}
                </div>
                {tags.map((tag) => (
                  <div key={tag.uid} className="matrix-row">
                    <span className="matrix-cell label">{tag.alias || tag.uid}</span>
                    {paired.map((box) => {
                      const blocked = (blockedByBox[box.box_id] || []).includes(tag.uid);
                      return (
                        <Message
                          key={box.box_id}
                          className={`matrix-cell toggle${blocked ? ' is-blocked' : ''}`}
                          severity={blocked ? 'error' : 'success'}
                          text={blocked ? 'Gesperrt' : 'OK'}
                          role="button"
                          tabIndex={0}
                          onClick={() =>
                            handleToggleTagBlock(box.box_id, tag.uid, !blocked)
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              handleToggleTagBlock(box.box_id, tag.uid, !blocked);
                            }
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      );
    }

    return (
      <div className="section-stack">
        <Card className="wide-card">
          <h3>System</h3>
          <p>Backend: {import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:5001'}</p>
          <div className="settings-row">
            <span>Gepairte Boxen</span>
            <span>{paired.length}</span>
          </div>
          <div className="settings-row">
            <span>Tags</span>
            <span>{tags.length}</span>
          </div>
        </Card>
      </div>
    );
  }

  const systemPanels = (
    <>
      <Card className="panel-card">
        <div className="card-title-row">
          <h3>Live Status</h3>
          <Tag value="Stable" severity="success" />
        </div>
        <p>System Health und wichtige Events.</p>
        <div className="status-row">
          <span>API</span>
          <Tag value="OK" severity="success" />
        </div>
        <div className="status-row">
          <span>Speicher</span>
          <Tag value={mediaTree ? formatSize(mediaTree.free_bytes) : '-'} severity="warning" />
        </div>
        <div className="status-row">
          <span>Letzter Sync</span>
          <span>{status?.last_sync_at ? formatTime(status.last_sync_at) : '-'}</span>
        </div>
        <div className="status-row">
          <span>Hardware-UID</span>
          <span>
            {lastHardwareUid.uid === status?.last_nfc?.uid && lastHardwareUid.hardwareUid
              ? lastHardwareUid.hardwareUid
              : activeNfc?.hardwareUid || '-'}
          </span>
        </div>
      </Card>
      <Card className="panel-card">
        <h3>Speicherkapazitaet</h3>
        <div className="capacity-row">
          <div className="capacity-header">
            <strong>System</strong>
            <span>
              {systemStorage
                ? `${formatSize(systemStorage.used)} / ${formatSize(systemStorage.total)}`
                : '-'}
            </span>
          </div>
          <MeterGroup
            className="capacity-bar"
            values={[{ label: '', value: systemStorage?.percent || 0 }]}
            style={{ '--capacity-scale': systemStorage?.scale || 1 }}
          />
          <div className="capacity-meta">
            Frei: {systemStorage ? formatSize(systemStorage.free) : '-'}
          </div>
        </div>
        <Divider />
        {boxes.length === 0 && <p className="muted">Keine Boxen verbunden.</p>}
        {boxes.map((box) => {
          const storage = boxStorage[box.box_id] || null;
          const used = storage?.used ?? null;
          const free = storage?.free ?? null;
          const total = storage?.total ?? null;
          const totalValue =
            total !== null ? total : used !== null && free !== null ? used + free : null;
          const usedValue =
            used !== null ? used : totalValue !== null && free !== null ? totalValue - free : null;
          const percent =
            totalValue && usedValue !== null
              ? Math.min(100, Math.round((usedValue / totalValue) * 100))
              : 0;
          const scale = capacityScale(percent);
          return (
            <div key={box.box_id} className="capacity-row">
              <div className="capacity-header">
                <strong>{box.alias || box.box_id}</strong>
                <span>
                  {totalValue !== null && usedValue !== null
                    ? `${formatSize(usedValue)} / ${formatSize(totalValue)}`
                    : '-'}
                </span>
              </div>
              <MeterGroup
                className="capacity-bar"
                values={[{ label: '', value: percent }]}
                style={{ '--capacity-scale': scale }}
              />
              <div className="capacity-meta">
                {free !== null ? `Frei: ${formatSize(free)}` : 'Keine Kapazitaet gemeldet'}
              </div>
            </div>
          );
        })}
      </Card>
    </>
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">K</div>
          <div>
            <strong>Klangkiste</strong>
            <span>PrimeReact GUI</span>
          </div>
        </div>
        {selectedId && (
          <div className="header-box-indicator">
            <i className="pi pi-check-circle" />
            <span>{activeBoxLabel || selectedId}</span>
          </div>
        )}
        <div className="topbar-actions">
          <Button icon="pi pi-bell" text rounded aria-label="Benachrichtigungen" />
          <Avatar label="MK" shape="circle" className="user-avatar" />
        </div>
      </header>

      <Toast ref={toastRef} position="top-right" />

      <div className="layout">
        <aside className="sidebar">
          <div className="sidebar-section">
            <p className="sidebar-title">Navigation</p>
            <div className="nav-list">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const iconProp = typeof Icon === 'string' ? Icon : <Icon size={16} />;
                return (
                  <Button
                    key={item.id}
                    label={item.label}
                    icon={iconProp}
                    text
                    className={`nav-button${activeSection === item.id ? ' active' : ''}`}
                    onClick={() => setActiveSection(item.id)}
                  />
                );
              })}
            </div>
          </div>
          <Divider />
          {/* <div className="sidebar-section">
            <p className="sidebar-title">Quick Actions</p>
            <div className="button-stack">
              <Button label="NFC Tag erstellen" icon="pi pi-plus" className="p-button-sm" />
              <Button label="Upload starten" icon="pi pi-upload" outlined className="p-button-sm" />
              <Button label="Box koppeln" icon="pi pi-link" text className="p-button-sm" />
            </div>
          </div>
          <Divider /> */}
          <div className="sidebar-section">
            <p className="sidebar-title">Aktive Sessions</p>
            {paired.length === 0 && (
              <p className="muted">Keine gepairten Boxen.</p>
            )}
            <div className="session-list">
              {paired.map((box) => {
                const isActive = selectedId === box.box_id;
                const label = (box.alias || box.box_id || '').slice(0, 2).toUpperCase();
                const availability = getAvailability(box.last_seen);
                return (
                  <Button
                    key={box.box_id}
                    className={`session-card${isActive ? ' active' : ''}`}
                    onClick={() => setSelectedId(box.box_id)}
                    title={`Aktiv setzen: ${box.alias || box.box_id}`}
                  >
                    <Avatar label={label || 'BX'} shape="circle" />
                    <div>
                      <strong>{box.alias || box.box_id}</strong>
                      {isActive && <span className="meta">Aktiv</span>}
                    </div>
                    <Tag value={availability.label} severity={availability.severity} rounded />
                  </Button>
                );
              })}
            </div>
          </div>
        </aside>

        <main className="content">
          <SectionHeader
            title={activeMeta?.label || 'Bereich'}
            subtitle="Live Daten und Steuerung der Klangkiste."
          />
          {error && <div className="error">{error}</div>}
          {activeNfc && dismissedNfcKey !== getNfcKey(activeNfc) && (
            <div className="legacy">
              <Card className="panel-card">
                <h3>
                  {activeNfc.uid &&
                  tags.find((tag) => tag.uid === activeNfc.uid && !tag.media_path)
                    ? 'Leerer Tag erkannt'
                    : 'Neuer Tag erkannt'}
                </h3>
                <p className="muted">
                  {activeNfc.uid ? (
                    <>
                      UID erkannt: <strong>{activeNfc.uid}</strong>
                    </>
                  ) : (
                    <>keine UID erkannt</>
                  )}
                </p>
                {activeNfc.uid &&
                lastHardwareUid.uid === activeNfc.uid &&
                lastHardwareUid.hardwareUid && (
                  <p className="muted">
                    Hardware-UID erkannt: <strong>{lastHardwareUid.hardwareUid}</strong>
                  </p>
                )}
                {!activeNfc.uid && activeNfc.hardwareUid && (
                  <p className="muted">
                    Hardware-UID erkannt: <strong>{activeNfc.hardwareUid}</strong>
                  </p>
                )}
                {activeNfc.uid && tags.find((tag) => tag.uid === activeNfc.uid) && (
                  <p className="muted">
                    Dieser Tag ist bekannt, aber noch nicht zugewiesen.
                  </p>
                )}
                <div className="step-messages">
                  <Messages ref={tagUidMsgRef} />
                  <Messages ref={mediaMsgRef} />
                </div>
                <Stepper
                  linear={false}
                  ref={tagStepperRef}
                  onChangeStep={(event) => {
                    if (event.index <= tagStepMax) {
                      setTagStep(event.index);
                      return;
                    }
                    tagStepperRef.current?.setActiveStep(tagStep);
                  }}
                >
                  <StepperPanel header="IDs">
                    <div className="controls">
                      <div className="step-row">
                        <InputText
                          value={scanTagUid}
                          onChange={(event) => setScanTagUid(event.target.value)}
                          readOnly={tagUidMode === 'keep'}
                          placeholder="Tag-ID (10 Zeichen)"
                          className="p-inputtext-sm"
                        />
                        <Button
                          label="Neue UID vergeben"
                          size="small"
                          outlined={tagUidMode !== 'new'}
                          onClick={() => {
                            setTagUidMode('new');
                            setScanTagUid(generateTagId());
                          }}
                        />
                        <span className="step-row-spacer" />
                        <Button
                          label="Weiter zu Medien"
                          size="small"
                          onClick={() => {
                            const uid = scanTagUid.trim();
                            if (!isValidTagUid(uid)) {
                              setTagUidError(
                                'UID ungueltig. Bitte 10 Zeichen (a-z, 0-9) oder TAG_ + 8 Zeichen verwenden.'
                              );
                              return;
                            }
                          if (tagUidError && tagUidError !== autoReplaceMsg) {
                            setTagUidError('');
                          }
                            setTagStepOneDone(true);
                            setTagStepMax(1);
                            setTagStep(1);
                          }}
                        />
                      </div>
                      <InputText
                        value={scanTagLabel}
                        onChange={(event) => setScanTagLabel(event.target.value)}
                        placeholder="Label (optional)"
                        className="p-inputtext-sm is-hidden"
                      />
                    </div>
                  </StepperPanel>
                  <StepperPanel header="Medienzuordnung">
                    <div className="controls">
                      <div className="step-row">
                        <Dropdown
                          value={scanMediaPath}
                          onChange={(event) => setScanMediaPath(event.value)}
                          options={collectTopLevelFolders(mediaTree).map((folderPath) => ({
                            label: folderPath,
                            value: folderPath,
                          }))}
                          placeholder="Medienordner waehlen"
                          filter
                          className="p-inputtext-sm"
                          disabled={!tagStepOneDone}
                        />
                        <span className="step-row-spacer" />
                        <Button
                          label="Weiter zur Anlage"
                          size="small"
                          disabled={!tagStepOneDone}
                          onClick={() => {
                            setTagStepTwoDone(true);
                            setTagStepMax(2);
                            setTagStep(2);
                          }}
                        />
                      </div>
                    </div>
                  </StepperPanel>
                  <StepperPanel header="Anlage">
                    <div className="controls">
                      <div className="summary">
                        <p className="summary-title">Zusammenfassung</p>
                        <div className="summary-grid">
                          <span>System-UID</span>
                          <strong>{scanTagUid || '-'}</strong>
                          <span>UID-Modus</span>
                          <strong>{tagUidMode === 'keep' ? 'Beibehalten' : 'Neu vergeben'}</strong>
                          <span>Label</span>
                          <strong>{scanTagLabel?.trim() || '-'}</strong>
                          <span>Medienordner</span>
                          <strong>{scanMediaPath || 'Spaeter zuordnen'}</strong>
                          <span>Hardware-UID</span>
                          <strong>
                            {lastHardwareUid.uid === activeNfc?.uid && lastHardwareUid.hardwareUid
                              ? lastHardwareUid.hardwareUid
                              : activeNfc?.hardwareUid || '-'}
                          </strong>
                        </div>
                      </div>
                      <div className="step-actions">
                        <Button
                          label="Daten zum Tag speichern"
                          size="small"
                          disabled={!tagStepOneDone || !tagStepTwoDone}
                          onClick={handleClaimTagForScan}
                        />
                      </div>
                    </div>
                  </StepperPanel>
                </Stepper>
                {tags.some((tag) => tag.status === 'IMPORTED') && (
                  <div className="controls">
                    <select className="p-inputtext-sm"
                      value={reuseTagUid}
                      onChange={(event) => setReuseTagUid(event.target.value)}
                    >
                      <option value="" disabled>
                        Gespeicherte Tag-ID waehlen
                      </option>
                      {tags
                        .filter((tag) => tag.status === 'IMPORTED')
                        .map((tag) => (
                          <option key={tag.uid} value={tag.uid}>
                            {tag.alias ? `${tag.alias} (${tag.uid})` : tag.uid}
                          </option>
                        ))}
                    </select>
                    <Button
                      label="Vorhandene ID schreiben"
                      size="small"
                      onClick={handleReuseImportedTag}
                    />
                  </div>
                )}
            </Card>
          </div>
          )}
          {renderSection()}
        </main>

        <aside className="right-panel">{systemPanels}</aside>
      </div>

      <nav className="bottom-nav">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.id}
              className={activeSection === item.id ? 'active' : ''}
              onClick={() => setActiveSection(item.id)}
            >
              {typeof Icon === 'string' ? (
                <i className={Icon} />
              ) : (
                <span className="nav-icon">
                  <Icon size={18} />
                </span>
              )}
              <span>{item.label}</span>
            </Button>
          );
        })}
        <Button
          className="bottom-action"
          onClick={() => setShowSessionSheet(true)}
        >
          <span className="nav-icon">
            <Wrench size={18} />
          </span>
          <span>ToolHub</span>
        </Button>
      </nav>

      {activeModal === 'new-folder' && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setActiveModal('');
            setUploadAfterCreate(false);
            setPendingUploadFiles([]);
            setUploadSize(0);
            setUploadNameError('');
            setTagDeleteTarget('');
          }}
        >
          <div
            className="modal-card modal-upload"
            onClick={(event) => event.stopPropagation()}
            ref={modalRef}
          >
            <h3>{uploadAfterCreate ? 'Upload vorbereiten' : 'Neuen Ordner anlegen'}</h3>
            <InputText
              value={newFolderName}
              onChange={(event) => {
                setNewFolderName(event.target.value);
                if (uploadNameError) setUploadNameError('');
              }}
              placeholder={
                uploadAfterCreate && !currentPath
                  ? 'Ordnername'
                  : uploadAfterCreate
                    ? 'Optionaler Ordnername (leer = aktueller Ordner)'
                    : 'Ordnername'
              }
              className="p-inputtext-sm"
            />
            {uploadAfterCreate && uploadNameError && (
              <p className="error">{uploadNameError}</p>
            )}
            {uploadAfterCreate && (
              <>
                <FileUpload
                  ref={fileUploadRef}
                  name="files[]"
                  multiple
                  accept="audio/*"
                  customUpload
                  auto={false}
                  disabled={uploadInProgress}
                  chooseOptions={{ icon: 'pi pi-file-arrow-up', iconOnly: true, className: 'p-button-rounded p-button-outlined' }}
                  uploadOptions={{ icon: 'pi pi-cloud-upload', iconOnly: true, className: 'p-button-success p-button-rounded p-button-outlined' }}
                  cancelOptions={{ icon: 'pi pi-times', iconOnly: true, className: 'p-button-danger p-button-rounded p-button-outlined' }}
                  headerTemplate={fileHeaderTemplate}
                  itemTemplate={fileItemTemplate}
                  onSelect={(event) => {
                    const audioFiles = (event.files || []).filter((file) =>
                      file.type.startsWith('audio/')
                    );
                    setPendingUploadFiles(audioFiles);
                    const nextSize = audioFiles.reduce((sum, file) => sum + file.size, 0);
                    setUploadSize(nextSize);
                    setActiveUploadLabel(
                      audioFiles.length
                        ? `Upload: ${audioFiles.length} Datei(en)`
                        : ''
                    );
                  }}
                  uploadHandler={(event) => {
                    const audioFiles = (event.files || []).filter((file) =>
                      file.type.startsWith('audio/')
                    );
                    setPendingUploadFiles(audioFiles);
                    const nextSize = audioFiles.reduce((sum, file) => sum + file.size, 0);
                    setUploadSize(nextSize);
                    setActiveUploadLabel(
                      audioFiles.length
                        ? `Upload: ${audioFiles.length} Datei(en)`
                        : ''
                    );
                    handleCreateFolder(audioFiles);
                  }}
                  onClear={() => {
                    setPendingUploadFiles([]);
                    setUploadSize(0);
                  }}
                  emptyTemplate={
                    <div style={{ display: 'flex', alignItems: 'center', flexDirection: 'column', gap: '0.75rem' }}>
                      <i className="pi pi-file-arrow-up" style={{ fontSize: '5em' }} />
                      <span style={{ fontSize: '1.2em', color: 'var(--text-color-secondary)' }}>
                        Drag and Drop Audio Here
                      </span>
                      <div className="upload-item-footer">
                        <span className="upload-item-total">Gesamt: {formatSize(uploadSize)}</span>
                      </div>
                    </div>
                  }
                />
                {pendingUploadFiles.length > 0 && (
                  <div className="upload-item-footer">
                    <span className="upload-item-total">Gesamt: {formatSize(uploadSize)}</span>
                    <span className="upload-item-count">
                      {pendingUploadFiles.length} Datei(en)
                    </span>
                  </div>
                )}
              </>
            )}
            <div className="modal-actions">
              <Button
                className="button-ghost"
                label="Abbrechen"
                onClick={() => {
                  setActiveModal('');
                  setUploadAfterCreate(false);
                  setPendingUploadFiles([]);
                  setUploadSize(0);
                  setUploadNameError('');
                  setTagDeleteTarget('');
                }}
              />
              <Button
                label={uploadAfterCreate ? 'Upload starten' : 'Ordner anlegen'}
                onClick={() => {
                  if (uploadAfterCreate) {
                    setActiveModal('');
                  }
                  handleCreateFolder();
                }}
              />
            </div>
          </div>
        </div>
      )}

      {activeModal === 'rename' && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setActiveModal('');
            setRenameName('');
          }}
        >
          <div
            className="modal-card modal-tag-delete"
            onClick={(event) => event.stopPropagation()}
            ref={modalRef}
          >
            <h3>Umbenennen</h3>
            <InputText
              value={renameName}
              onChange={(event) => setRenameName(event.target.value)}
              placeholder="Neuer Name"
              className="p-inputtext-sm"
            />
            <div className="modal-actions">
              <Button
                className="button-ghost"
                label="Abbrechen"
                onClick={() => {
                  setActiveModal('');
                  setRenameName('');
                }}
              />
              <Button label="Speichern" onClick={handleRename} />
            </div>
          </div>
        </div>
      )}

      {activeModal === 'delete' && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setActiveModal('');
          }}
        >
          <div
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
            ref={modalRef}
          >
            <h3>Eintraege loeschen</h3>
            <p className="muted">{selectedPaths.length} Eintraege werden geloescht.</p>
            <div className="modal-actions">
              <Button className="button-ghost" label="Abbrechen" onClick={() => setActiveModal('')} />
              <Button severity="danger" onClick={handleDeleteSelected} label="Loeschen" />
            </div>
          </div>
        </div>
      )}

      {activeModal === 'move' && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setActiveModal('');
            setMoveTarget('');
          }}
        >
          <div
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
            ref={modalRef}
          >
            <h3>Verschieben</h3>
            <Dropdown
              value={moveTarget || null}
              onChange={(event) => setMoveTarget(event.value)}
              options={[
                { label: 'media/', value: '__root__' },
                ...collectFolderPaths(mediaTree).map((folder) => ({
                  label: folder,
                  value: folder,
                })),
              ]}
              placeholder="Zielordner waehlen"
              filter
              className="p-inputtext-sm"
            />
            <div className="modal-actions">
              <Button
                className="button-ghost"
                label="Abbrechen"
                onClick={() => {
                  setActiveModal('');
                  setMoveTarget('');
                }}
              />
              <Button label="Verschieben" onClick={handleMoveSelected} />
            </div>
          </div>
        </div>
      )}

      {activeModal === 'tag-delete' && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setActiveModal('');
            setTagDeleteTarget('');
          }}
        >
          <div
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
            ref={modalRef}
          >
            <h3>Tag entfernen</h3>
            <p className="muted">
              Soll der Tag komplett geloescht werden oder nur die Medienzuweisung?
            </p>
            <div className="modal-actions">
              <Button
                className="button-ghost"
                label="Abbrechen"
                onClick={() => {
                  setActiveModal('');
                  setTagDeleteTarget('');
                }}
              />
              <Button
                label="Nur Medienzuordnung entfernen"
                className="modal-long-button"
                onClick={async () => {
                  if (!tagDeleteTarget) return;
                  await handleClearTagMedia(tagDeleteTarget);
                  setTagDeleteTarget('');
                  setActiveModal('');
                }}
              />
              <Button
                severity="danger"
                label="Tag loeschen"
                className="modal-long-button"
                onClick={async () => {
                  if (!tagDeleteTarget) return;
                  await handleClearTagMedia(tagDeleteTarget);
                  await handleDeleteTag(tagDeleteTarget);
                  setTagDeleteTarget('');
                  setActiveModal('');
                }}
              />
            </div>
          </div>
        </div>
      )}

      {boxDeleteTarget && (
        <div
          className="modal-backdrop"
          onClick={() => setBoxDeleteTarget('')}
        >
          <div
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
            ref={modalRef}
          >
            <h3>Box entfernen</h3>
            <p className="muted">Soll die Box wirklich entkoppelt werden?</p>
            <div className="modal-actions">
              <Button
                className="button-ghost"
                label="Abbrechen"
                onClick={() => setBoxDeleteTarget('')}
              />
              <Button
                severity="danger"
                label="Box entfernen"
                onClick={async () => {
                  if (!boxDeleteTarget) return;
                  await handleUnpair(boxDeleteTarget);
                  setBoxDeleteTarget('');
                }}
              />
            </div>
          </div>
        </div>
      )}

      {boxDetailsOpen && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setBoxDetailsOpen(false);
            setBoxDetailsError('');
            setBoxDetailsData(null);
          }}
          role="presentation"
        >
          <div className="modal-card" ref={modalRef} onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Box Details</h3>
              <Button
                className="icon-button"
                icon="pi pi-times"
                onClick={() => {
                  setBoxDetailsOpen(false);
                  setBoxDetailsError('');
                  setBoxDetailsData(null);
                }}
                aria-label="Schliessen"
              />
            </div>
            <div className="modal-body">
              {boxDetailsLoading && <p className="muted">Details werden geladen...</p>}
              {boxDetailsError && <p className="error">{boxDetailsError}</p>}
              {!boxDetailsLoading && !boxDetailsError && boxDetailsData && (
                <div className="details-stack">
                  <div>
                    <strong>Box</strong>
                    <div className="meta">ID: {boxDetailsData.box_id}</div>
                    <div className="meta">
                      Firmware: {boxDetailsData.firmware_version || '0.0.0'}
                    </div>
                  </div>
                  <Divider />
                  <div>
                    <strong>Settings</strong>
                    <div className="meta">
                      Max Volume: {boxDetailsData.settings?.max_volume ?? '-'}
                    </div>
                    <div className="meta">
                      Default Volume: {boxDetailsData.settings?.default_volume ?? '-'}
                    </div>
                  </div>
                  <Divider />
                  <div>
                    <strong>Gespeicherte WLANs</strong>
                    {Array.isArray(boxDetailsData.wifi_profiles) &&
                    boxDetailsData.wifi_profiles.length > 0 ? (
                      boxDetailsData.wifi_profiles.map((profile) => (
                        <div key={profile.ssid} className="meta">
                          {profile.ssid} (prio {profile.priority ?? 0})
                        </div>
                      ))
                    ) : (
                      <div className="muted">Keine Profile.</div>
                    )}
                  </div>
                  <Divider />
                  <div>
                    <strong>Tags</strong>
                    {boxDetailsData.tags && Object.keys(boxDetailsData.tags).length > 0 ? (
                      Object.entries(boxDetailsData.tags).map(([uid, tag]) => (
                        <div key={uid} className="meta">
                          {uid}: {tag?.path || '-'}
                        </div>
                      ))
                    ) : (
                      <div className="muted">Keine Tags.</div>
                    )}
                  </div>
                  <Divider />
                  <div>
                    <strong>Server</strong>
                    <div className="meta">
                      Active URL: {boxDetailsData.active_server_url || '-'}
                    </div>
                    <div className="meta">
                      Last SSID: {boxDetailsData.last_ssid || '-'}
                    </div>
                    {boxDetailsData.server_bindings &&
                    Object.keys(boxDetailsData.server_bindings).length > 0 ? (
                      Object.entries(boxDetailsData.server_bindings).map(
                        ([ssid, binding]) => (
                          <div key={ssid} className="meta">
                            {ssid}: {binding?.server_url || '-'}
                          </div>
                        )
                      )
                    ) : (
                      <div className="muted">Keine Bindings.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeModal === 'import-tag' && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card" ref={modalRef}>
            <div className="modal-header">
              <h3>Tag vom Box-Speicher uebertragen</h3>
            </div>
            <div className="modal-body">
              <label className="modal-label" htmlFor="import-folder">
                Neuer Ordnername auf dem Server
              </label>
              <InputText
                id="import-folder"
                value={importTargetFolder}
                onChange={(event) => setImportTargetFolder(event.target.value)}
                placeholder="z. B. grimm_volume_3"
                className="p-inputtext-sm"
              />
              {uploadInProgress && (
                <div className="upload-progress">
                  <div style={{ width: `${uploadProgress}%` }} />
                </div>
              )}
            </div>
            <div className="modal-actions">
              <Button
                className="button-ghost"
                label="Abbrechen"
                onClick={() => {
                  setActiveModal('');
                  setImportTargetFolder('');
                  setImportTargetUid('');
                }}
              />
              <Button label="Uebertragen" onClick={handlePullTagFromBox} />
            </div>
          </div>
        </div>
      )}

      {showSessionSheet && (
        <div
          className="sheet-backdrop"
          onClick={() => setShowSessionSheet(false)}
        >
          <div
            className="sheet-card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sheet-header">
              <strong>ToolHub</strong>
              <Button
                className="icon-button"
                icon="pi pi-times"
                onClick={() => setShowSessionSheet(false)}
                aria-label="Schliessen"
              />
            </div>
            {drawerTab === 'boxes' && (
              <>
                {paired.length === 0 && (
                  <p className="muted">Keine gepairten Boxen.</p>
                )}
                <div className="session-list">
                  {paired.map((box) => {
                    const isActive = selectedId === box.box_id;
                    const label = (box.alias || box.box_id || '').slice(0, 2).toUpperCase();
                    const availability = getAvailability(box.last_seen);
                    return (
                      <Button
                        key={box.box_id}
                        className={`session-card${isActive ? ' active' : ''}`}
                        onClick={() => {
                          setSelectedId(box.box_id);
                          setShowSessionSheet(false);
                        }}
                      >
                        <Avatar label={label || 'BX'} shape="circle" />
                        <div>
                          <strong>{box.alias || box.box_id}</strong>
                          {isActive && <span className="meta">Aktiv</span>}
                        </div>
                        <Tag value={availability.label} severity={availability.severity} rounded />
                      </Button>
                    );
                  })}
                </div>
              </>
            )}
            {drawerTab === 'system' && (
              <div className="drawer-system">{systemPanels}</div>
            )}
            <div className="drawer-tabs">
              <Button
                className={`drawer-tab${drawerTab === 'boxes' ? ' active' : ''}`}
                onClick={() => setDrawerTab('boxes')}
              >
                <span className="nav-icon">
                  <Cube size={18} />
                </span>
                <span>Boxen</span>
              </Button>
              <Button
                className={`drawer-tab${drawerTab === 'system' ? ' active' : ''}`}
                onClick={() => setDrawerTab('system')}
              >
                <span className="nav-icon">
                  <GearSix size={18} />
                </span>
                <span>System</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
