const SUPABASE_URL = 'https://viziujnkpnpdzikcdnrc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpeml1am5rcG5wZHppa2NkbnJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MTkwNjMsImV4cCI6MjA5NTM5NTA2M30.YGAeGV232SQX8CIv3XGnK4l3pJS9kDwaeMYhouPc4tU';

const DEFAULT_CLIENTS = ['S2L', 'Land Shark', 'GGG', 'Internal'];

function getClients() {
  const extras = JSON.parse(localStorage.getItem('extra_clients') || '[]');
  return [...DEFAULT_CLIENTS, ...extras.filter(c => !DEFAULT_CLIENTS.includes(c))];
}

function addClient(name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const extras = JSON.parse(localStorage.getItem('extra_clients') || '[]');
  if (!getClients().includes(trimmed)) {
    extras.push(trimmed);
    localStorage.setItem('extra_clients', JSON.stringify(extras));
  }
}
