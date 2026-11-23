
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

const MIN_ID = 700000;
const MAX_ID = 799999;
const CHANNEL = 'gdf-reminders';

function makeId(key) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return MIN_ID + ((hash >>> 0) % (MAX_ID - MIN_ID + 1));
}

function localDate(date, hour = 9) {
  if (!date) return null;
  const p = String(date).slice(0, 10).split('-').map(Number);
  if (p.length !== 3 || p.some(n => !n)) return null;
  return new Date(p[0], p[1] - 1, p[2], hour, 0, 0);
}

function shiftDate(date, days) {
  const d = localDate(date);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return d;
}

function isFuture(d) {
  return d instanceof Date &&
    !Number.isNaN(d.getTime()) &&
    d.getTime() > Date.now() + 60000;
}

function animalName(db, id) {
  const c = (db.cows || []).find(x => String(x.id) === String(id));
  return c ? (c.tag || 'Animal') + (c.name ? ' - ' + c.name : '') : 'Animal';
}

function addReminder(list, key, title, body, date) {
  if (!isFuture(date)) return;
  list.push({
    id: makeId(key),
    title,
    body,
    schedule: { at: date, allowWhileIdle: true },
    channelId: CHANNEL
  });
}

async function enable() {
  if (!Capacitor.isNativePlatform()) {
    alert('Please use the installed Android app.');
    return false;
  }

  let permission = await LocalNotifications.checkPermissions();

  if (permission.display !== 'granted') {
    permission = await LocalNotifications.requestPermissions();
  }

  if (permission.display !== 'granted') return false;

  await LocalNotifications.createChannel({
    id: CHANNEL,
    name: 'Dairy Farm Reminders',
    description: 'Vaccine, treatment, breeding and calving alerts',
    importance: 4,
    vibration: true
  });

  return true;
}

async function sync(db) {
  if (!Capacitor.isNativePlatform()) return;

  const permission = await LocalNotifications.checkPermissions();
  if (permission.display !== 'granted') return;

  await LocalNotifications.createChannel({
    id: CHANNEL,
    name: 'Dairy Farm Reminders',
    description: 'Dairy farm alerts',
    importance: 4,
    vibration: true
  });

  const pending = await LocalNotifications.getPending();
  const old = (pending.notifications || [])
    .filter(n => n.id >= MIN_ID && n.id <= MAX_ID)
    .map(n => ({ id: n.id }));

  if (old.length) {
    await LocalNotifications.cancel({ notifications: old });
  }

  const reminders = [];

  // Vaccine, treatment and deworming
  for (const h of (db.health || [])) {
    if (!h.next) continue;

    const animal = animalName(db, h.cow);
    const detail = h.detail || h.kind || 'Health follow-up';

    addReminder(
      reminders,
      'health-before-' + h.id + h.next,
      'Dairy Reminder - Tomorrow',
      animal + ': ' + detail + ' due tomorrow',
      shiftDate(h.next, -1)
    );

    addReminder(
      reminders,
      'health-due-' + h.id + h.next,
      'Dairy Reminder - Today',
      animal + ': ' + detail + ' due today',
      localDate(h.next)
    );
  }

  // AI, pregnancy check and heat observation
  for (const b of (db.breed || [])) {
    const animal = animalName(db, b.cow);

    if (b.date) {
      addReminder(
        reminders,
        'ai30-' + b.id,
        'Pregnancy Check',
        animal + ': AI ton 30 din ho gaye. Pregnancy check karvao.',
        shiftDate(b.date, 30)
      );

      addReminder(
        reminders,
        'ai45-' + b.id,
        'Pregnancy Recheck',
        animal + ': AI ton 45 din ho gaye. Vet di salah naal recheck.',
        shiftDate(b.date, 45)
      );

      addReminder(
        reminders,
        'heat21-' + b.id,
        'Heat Observation',
        animal + ': AI ton 21 din. Heat de signs check karo.',
        shiftDate(b.date, 21)
      );
    }

    // Expected calving
    if (b.due) {
      addReminder(
        reminders,
        'calving-before-' + b.id + b.due,
        'Expected Calving Tomorrow',
        animal + ': expected calving tomorrow.',
        shiftDate(b.due, -1)
      );

      addReminder(
        reminders,
        'calving-today-' + b.id + b.due,
        'Expected Calving Today',
        animal + ': expected calving date today.',
        localDate(b.due)
      );
    }
  }

  if (reminders.length) {
    await LocalNotifications.schedule({
      notifications: reminders.slice(0, 60)
    });
  }
}

window.GDFNotifications = { enable, sync };

window.addEventListener('load', () => {
  try {
    const db = JSON.parse(
      localStorage.getItem('gdf_db') ||
      '{"cows":[],"health":[],"breed":[]}'
    );
    sync(db).catch(console.warn);
  } catch (e) {
    console.warn('Reminder error:', e);
  }
});
