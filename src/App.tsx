import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, 
  MapPin, 
  Building2, 
  Mail, 
  BarChart3, 
  ExternalLink, 
  Copy, 
  RefreshCw,
  Loader2,
  ChevronRight,
  Target,
  FileText,
  Eye,
  ArrowRight
} from 'lucide-react';
import { US_CITIES, CATEGORY_MAP } from './constants';

interface Lead {
  name: string;
  website: string;
  address_line1?: string;
  city?: string;
  state?: string;
  postcode?: string;
  place_id: string;
}

interface Enrichment {
  emails: string[];
  auditResult: any;
  screenshotUrl: string;
}

export default function App() {
  const [niche, setNiche] = useState('Dentist');
  const [city, setCity] = useState('New York');
  const [state, setState] = useState('NY');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingIdx, setProcessingIdx] = useState<number | null>(null);
  const [enrichments, setEnrichments] = useState<Record<string, Enrichment>>({});

  // Auto-update state when city changes
  useEffect(() => {
    const cityData = US_CITIES.find(c => c.city === city);
    if (cityData) {
      setState(cityData.state);
    }
  }, [city]);

  const handleSearch = async () => {
    setSearching(true);
    setError(null);
    setLeads([]);
    setEnrichments({});
    try {
      const res = await fetch('/api/leads/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city,
          state,
          nicheCategory: CATEGORY_MAP[niche]
        })
      });
      
      const contentType = res.headers.get("content-type");
      if (!res.ok) {
        let errorMessage = `Server error: ${res.status}`;
        if (contentType && contentType.includes("application/json")) {
           try {
             const errData = await res.json();
             errorMessage = errData.error || errorMessage;
           } catch {
             errorMessage = "Server returned an error with invalid JSON.";
           }
        } else {
           const text = await res.text();
           errorMessage = text.slice(0, 100) || errorMessage;
        }
        throw new Error(errorMessage);
      }

      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Target server did not return JSON. The backend might be down or transitioning.");
      }

      const data = await res.json();
      if (data.leads && data.leads.length > 0) {
        setLeads(data.leads);
        processLeads(data.leads);
      } else {
        setError(`No leads found for ${niche} in ${city}. Try a broader niche or a larger US city.`);
      }
    } catch (e: any) {
      setError(e.message);
      console.error("[Search Error]", e);
    } finally {
      setSearching(false);
    }
  };

  const processLeads = async (newLeads: Lead[]) => {
    for (let i = 0; i < newLeads.length; i++) {
      setProcessingIdx(i);
      const lead = newLeads[i];
      try {
        const res = await fetch('/api/leads/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ website: lead.website, name: lead.name })
        });
        
        if (res.ok) {
          const data = await res.json();
          setEnrichments(prev => ({ ...prev, [lead.place_id]: data }));
        }
      } catch (e) {
        console.error(`[Enrich Error] Lead ${lead.name}:`, e);
      }
    }
    setProcessingIdx(null);
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-200 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-800 flex flex-col bg-slate-950 shrink-0">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Target className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white">ProspectPilot</h1>
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          <a href="#" className="flex items-center gap-3 px-3 py-2 bg-slate-900 text-indigo-400 rounded-md border border-slate-800 shadow-sm transition-all">
            <Search className="w-4 h-4" />
            <span className="font-medium text-sm">Scrape Leads</span>
          </a>
          <a href="#" className="flex items-center gap-3 px-3 py-2 text-slate-400 hover:bg-slate-900 rounded-md transition-colors group">
            <Mail className="w-4 h-4 group-hover:text-slate-200" />
            <span className="text-sm">Campaigns</span>
          </a>
          <a href="#" className="flex items-center gap-3 px-3 py-2 text-slate-400 hover:bg-slate-900 rounded-md transition-colors group">
            <BarChart3 className="w-4 h-4 group-hover:text-slate-200" />
            <span className="text-sm">Analytics</span>
          </a>
        </nav>
        <div className="p-4 border-t border-slate-800">
          <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
            <p className="text-[10px] text-slate-500 uppercase font-bold mb-2 tracking-widest">API Credits</p>
            <div className="w-full bg-slate-800 h-1.5 rounded-full mb-1 overflow-hidden">
              <div className="bg-indigo-500 h-full w-2/3 shadow-[0_0_8px_rgba(99,102,241,0.5)]"></div>
            </div>
            <p className="text-[10px] text-slate-400 text-right font-mono">1,240 / 2,000 left</p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-950 overflow-hidden relative">
        {/* Header / Search Area */}
        <header className="p-6 border-b border-slate-800 bg-slate-900/30 backdrop-blur-sm sticky top-0 z-40 shrink-0">
          <div className="flex flex-col md:flex-row items-stretch md:items-end justify-between gap-4">
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5 text-left">
                <label className="text-[10px] text-slate-500 uppercase font-bold px-1 tracking-wider">Target Niche</label>
                <select 
                  value={niche}
                  onChange={e => setNiche(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500 transition-colors w-full appearance-none"
                >
                  {Object.keys(CATEGORY_MAP).map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5 text-left">
                <label className="text-[10px] text-slate-500 uppercase font-bold px-1 tracking-wider">City</label>
                <select 
                  value={city}
                  onChange={e => setCity(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500 transition-colors w-full appearance-none"
                >
                  {US_CITIES.map(c => <option key={c.city} value={c.city}>{c.city}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5 text-left">
                <label className="text-[10px] text-slate-500 uppercase font-bold px-1 tracking-wider">State</label>
                <input 
                  type="text" 
                  value={state} 
                  readOnly 
                  disabled 
                  className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-500 cursor-not-allowed w-full font-mono"
                />
              </div>
            </div>
            <button 
              onClick={handleSearch}
              disabled={searching || processingIdx !== null}
              className="md:mt-0 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-md font-semibold text-sm shadow-lg shadow-indigo-500/20 transition-all active:scale-[0.98] shrink-0 flex items-center justify-center gap-2"
            >
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
              {searching ? 'Launching Scraper...' : 'Launch Scraper'}
            </button>
          </div>
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-md flex items-center gap-2 text-rose-400 text-xs font-medium"
            >
              <Target className="w-3.5 h-3.5" />
              {error}
              <button onClick={() => setError(null)} className="ml-auto opacity-50 hover:opacity-100 italic">dismiss</button>
            </motion.div>
          )}
        </header>

        {/* Progress Tracker (Conditional) */}
        <AnimatePresence>
          {(searching || processingIdx !== null) && (
            <motion.section 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="px-6 py-4 bg-slate-900/10 border-b border-slate-800 overflow-hidden shrink-0"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-indigo-400">
                  {searching ? 'Querying local businesses...' : `Processing: ${leads[processingIdx!]?.name || '...'}`}
                </span>
                <span className="text-xs text-slate-500 italic">
                  {searching ? 'Step 1/5: Geocoding...' : `Auditing ${processingIdx! + 1}/${leads.length}`}
                </span>
              </div>
              <div className="flex gap-1 h-1.5 w-full">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div 
                    key={i} 
                    className={`flex-1 rounded-full transition-all duration-500 ${
                      searching ? (i === 0 ? 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]' : 'bg-slate-800') :
                      (i <= (processingIdx === null ? 0 : 3) ? 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]' : 'bg-slate-800')
                    } ${i === (searching ? 0 : 4) && 'animate-pulse'}`}
                  ></div>
                ))}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Results Feed */}
        <div className="flex-1 p-6 space-y-6 overflow-y-auto min-h-0 bg-slate-950">
          <div className="flex items-center justify-between sticky top-0 bg-slate-950 z-10 py-2">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Recent Leads Found</h2>
            <span className="px-2 py-0.5 bg-slate-900 border border-slate-700 rounded text-[10px] text-slate-400 font-mono">
              {leads.length} Results Found
            </span>
          </div>
          
          <div className="grid grid-cols-1 gap-4">
            <AnimatePresence mode="popLayout">
              {leads.map((lead, idx) => (
                <LeadCard 
                  key={lead.place_id + idx}
                  lead={lead} 
                  enrichment={enrichments[lead.place_id]}
                  isProcessing={processingIdx === idx}
                  index={idx}
                />
              ))}
            </AnimatePresence>

            {leads.length === 0 && !searching && (
              <div className="py-32 flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-16 h-16 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center">
                  <Target className="w-8 h-8 text-slate-700" />
                </div>
                <h3 className="text-lg font-bold text-slate-200">Ready to Hunt?</h3>
                <p className="text-slate-500 max-w-xs text-sm">Select target niche and city above to populate your lead bank with AI-audited prospects.</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer Status */}
        <footer className="px-6 py-3 border-t border-slate-800 bg-slate-900/50 flex items-center justify-between text-[10px] text-slate-500 shrink-0">
          <div className="flex gap-4">
            <span className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_#10b981]"></div> Geoapify: Active
            </span>
            <span className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_#10b981]"></div> Gemini Vision: Ready
            </span>
          </div>
          <span className="font-mono opacity-50">STABLE BUILD 2.4.1</span>
        </footer>
      </main>
    </div>
  );
}

function LeadCard({ lead, enrichment, isProcessing, index }: any) {
  const [activeTab, setActiveTab] = useState<'audit' | 'email'>('audit');
  const [manualEmail, setManualEmail] = useState('');

  useEffect(() => {
    if (enrichment?.emails?.[0] && !manualEmail) {
      setManualEmail(enrichment.emails[0]);
    }
  }, [enrichment]);

  useEffect(() => {
    if (enrichment?.emails?.[0] && manualEmail === '') {
       const timer = setTimeout(() => {
         setManualEmail(enrichment.emails[0]);
       }, 2000);
       return () => clearTimeout(timer);
    }
  }, [manualEmail, enrichment]);

  const auditScore = enrichment?.auditResult?.audit?.score || 0;
  const scoreStyles = auditScore > 75 ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]' : 
                      auditScore > 50 ? 'text-amber-400 bg-amber-400/10 border-amber-400/20' : 
                      'text-rose-400 bg-rose-400/10 border-rose-400/20';

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, x: -20, scale: 0.98 }}
      animate={{ opacity: isProcessing ? 1 : enrichment ? 1 : 0.6, x: 0, scale: 1 }}
      transition={{ duration: 0.4, delay: (index % 10) * 0.05 }}
      className={`bg-slate-900 border ${isProcessing ? 'border-indigo-500 shadow-2xl shadow-indigo-500/10' : 'border-slate-800'} rounded-xl overflow-hidden flex flex-col md:flex-row shadow-lg transition-transform hover:translate-x-1 duration-300`}
    >
      {/* Visual Section */}
      <div className="w-full md:w-56 bg-slate-800 flex items-center justify-center border-b md:border-b-0 md:border-r border-slate-700 relative group shrink-0">
        {enrichment?.screenshotUrl ? (
          <>
            <img src={enrichment.screenshotUrl} alt="Audit Screenshot" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer">
              <span className="text-[10px] text-white bg-black/60 px-2 py-1 rounded backdrop-blur-sm border border-white/10 font-bold tracking-widest uppercase">View Site</span>
            </div>
          </>
        ) : (
          <div className="w-full h-40 md:h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
            <Eye className="w-8 h-8 text-slate-700" />
            <span className="text-[10px] text-slate-600 font-bold uppercase tracking-widest leading-tight">AI Agent <br/> Analysing...</span>
          </div>
        )}
        {isProcessing && (
          <div className="absolute inset-0 bg-indigo-600/20 backdrop-blur-[1px] flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-white animate-spin" />
          </div>
        )}
      </div>

      {/* Content Section */}
      <div className="flex-1 p-5 flex flex-col overflow-hidden">
        <div className="flex justify-between items-start gap-4">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-white leading-tight truncate">{lead.name}</h3>
            <p className="text-xs text-indigo-400 mb-1 flex items-center gap-1.5 font-medium truncate">
               <span className="truncate">{new URL(lead.website).hostname}</span>
               <span className="text-slate-700">•</span>
               <span className="text-slate-500 capitalize">{lead.city}, {lead.state}</span>
            </p>
          </div>
          <div className="flex flex-col items-end shrink-0 gap-1">
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded border italic ${scoreStyles}`}>
              {enrichment ? `Audit: ${auditScore}%` : 'Auditing...'}
            </span>
            {enrichment && auditScore > 75 && <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">High Priority</span>}
          </div>
        </div>
        
        {/* Info Grid */}
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <div className="p-3 bg-slate-950/50 rounded-lg border border-slate-800 space-y-1.5 transition-colors hover:border-slate-700">
            <p className="text-[9px] text-slate-500 uppercase font-black tracking-widest flex items-center gap-1.5">
              <Eye className="w-3 h-3 text-indigo-400" /> AI Audit Insight
            </p>
            {enrichment?.auditResult?.audit ? (
              <p className="text-xs text-slate-300 leading-relaxed line-clamp-2 md:line-clamp-3 font-medium">
                {enrichment.auditResult.audit.gap}. {enrichment.auditResult.audit.insight}
              </p>
            ) : (
              <div className="space-y-2 py-1">
                <div className="h-2 bg-slate-800 rounded w-full animate-pulse"></div>
                <div className="h-2 bg-slate-800 rounded w-2/3 animate-pulse"></div>
              </div>
            )}
          </div>
          <div className="p-3 bg-slate-950/50 rounded-lg border border-slate-800 space-y-1.5 transition-colors hover:border-slate-700">
            <p className="text-[9px] text-slate-500 uppercase font-black tracking-widest flex items-center gap-1.5">
              <Mail className="w-3 h-3 text-indigo-400" /> Cold Draft Preview
            </p>
            {enrichment?.auditResult?.email ? (
              <p className="text-xs italic text-slate-400 leading-relaxed line-clamp-2 md:line-clamp-3 font-medium">
                "{enrichment.auditResult.email.body.substring(0, 120)}..."
              </p>
            ) : (
              <div className="space-y-2 py-1">
                <div className="h-2 bg-slate-800 rounded w-full animate-pulse"></div>
                <div className="h-2 bg-slate-800 rounded w-2/3 animate-pulse"></div>
              </div>
            )}
          </div>
        </div>

        {/* Action Bar */}
        <div className="mt-5 pt-3 border-t border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-2 h-2 rounded-full shrink-0 ${enrichment?.emails?.[0] ? 'bg-emerald-500 shadow-[0_0_8px_#10b981] animate-pulse' : 'bg-slate-700'}`}></div>
            <span className="text-[13px] text-slate-300 font-mono truncate">
              {enrichment?.emails?.[0] || 'Email pending audit...'}
            </span>
            {enrichment?.emails?.[0] && (
              <button 
                onClick={() => navigator.clipboard.writeText(enrichment.emails[0])}
                className="p-1 text-slate-500 hover:text-indigo-400 transition-colors shrink-0"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <button className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white transition-colors">Details</button>
            <button className="px-4 py-1.5 bg-slate-200 text-slate-950 text-[10px] font-black uppercase tracking-widest rounded hover:bg-white transition-colors active:scale-95 shadow-lg shadow-white/5">Generate Email</button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}


