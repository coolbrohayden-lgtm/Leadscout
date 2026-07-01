// LeadScout — shared Supabase auth utility
// Loaded by restaurant_lead_finder.html and database.html

const SUPA_URL = 'https://yiutqeuiwdrfiwioyhwr.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpdXRxZXVpd2RyZml3aW95aHdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNzU3NDgsImV4cCI6MjA5Nzg1MTc0OH0.TlIwAggWacEj1ZutusH-gaMa2LSt_ZAjov-2Ao3LHlo';

// Global supabase client used by both pages
const supabaseClient = supabase.createClient(SUPA_URL, SUPA_KEY);

// Current authenticated user (populated by requireAuth)
let currentUser = null;

async function getCurrentUser() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  return user;
}

async function getUserName() {
  if (!currentUser) return '';
  // Try user_metadata first (set at sign-up)
  if (currentUser.user_metadata && currentUser.user_metadata.name) {
    return currentUser.user_metadata.name;
  }
  // Fallback: query user_profiles table
  const { data } = await supabaseClient.from('user_profiles').select('name').eq('id', currentUser.id).single();
  return (data && data.name) ? data.name : currentUser.email;
}

const ADMIN_EMAIL = 'coolbrohayden@gmail.com';

function isAdmin() {
  return currentUser && currentUser.email === ADMIN_EMAIL;
}

async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = '/login';
    return null;
  }
  currentUser = user;
  return user;
}

async function signOut() {
  await supabaseClient.auth.signOut();
  window.location.href = '/login';
}
