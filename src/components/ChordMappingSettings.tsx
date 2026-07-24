import { useState, FormEvent, MouseEvent } from 'react';
import { ChordMapping, GESTURES, Preset } from '../types';
import { loadPresets, savePresets, DEFAULT_PRESETS } from '../utils/presets';
import { Save, Plus, Trash2, FolderOpen, ArrowRight, Settings, Info, Sliders } from 'lucide-react';

interface ChordMappingSettingsProps {
  activePreset: Preset;
  onActivePresetChange: (preset: Preset) => void;
}

export default function ChordMappingSettings({
  activePreset,
  onActivePresetChange,
}: ChordMappingSettingsProps) {
  const [presets, setPresets] = useState<Preset[]>(loadPresets);
  const [newPresetName, setNewPresetName] = useState('');
  const [editMappings, setEditMappings] = useState<ChordMapping[]>([...activePreset.mappings]);
  const [editingPresetId, setEditingPresetId] = useState<string>(activePreset.id);

  // When a preset is selected
  const handleSelectPreset = (id: string) => {
    const selected = presets.find((p) => p.id === id);
    if (selected) {
      setEditingPresetId(id);
      setEditMappings([...selected.mappings]);
      onActivePresetChange(selected);
    }
  };

  // When chord input is modified for a gesture
  const handleChordChange = (gestureId: string, newValue: string) => {
    const updated = editMappings.map((m) => {
      if (m.gestureId === gestureId) {
        return { ...m, chord: newValue.trim() };
      }
      return m;
    });
    setEditMappings(updated);

    // Auto update current active preset mappings so change is live instantly
    onActivePresetChange({
      ...activePreset,
      mappings: updated,
    });
  };

  // Create/Save a new custom preset
  const handleCreatePreset = (e: FormEvent) => {
    e.preventDefault();
    if (!newPresetName.trim()) return;

    const newId = 'custom_' + Date.now();
    const newPreset: Preset = {
      id: newId,
      name: newPresetName.trim(),
      mappings: [...editMappings],
    };

    const updatedPresets = [...presets, newPreset];
    setPresets(updatedPresets);
    savePresets(updatedPresets);
    setNewPresetName('');
    handleSelectPreset(newId);
  };

  // Save changes to current preset
  const handleSaveCurrentPreset = () => {
    const updatedPresets = presets.map((p) => {
      if (p.id === editingPresetId) {
        return { ...p, mappings: [...editMappings] };
      }
      return p;
    });
    setPresets(updatedPresets);
    savePresets(updatedPresets);
  };

  // Delete custom preset
  const handleDeletePreset = (id: string, e: MouseEvent) => {
    e.stopPropagation();
    // Don't allow deleting standard built-in presets
    if (id === 'standard' || id === 'blues' || id === 'jazz') {
      alert('Built-in presets cannot be deleted.');
      return;
    }

    const updatedPresets = presets.filter((p) => p.id !== id);
    setPresets(updatedPresets);
    savePresets(updatedPresets);

    if (editingPresetId === id) {
      // Fallback to standard
      handleSelectPreset('standard');
    }
  };

  return (
    <div id="chord_settings_panel" className="flex flex-col gap-6 w-full max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row gap-6">
        
        {/* Preset Selector Sidebar */}
        <div className="w-full md:w-72 flex flex-col gap-4 bg-white/[0.01] backdrop-blur-md border border-white/5 p-4 rounded-2xl shadow-xl relative">
          <div className="absolute top-0 left-4 right-4 h-[1px] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
          <div className="flex items-center gap-2 border-b border-white/5 pb-3">
            <FolderOpen className="w-4 h-4 text-[#00FF41]" />
            <h3 className="font-mono font-bold text-xs uppercase text-white tracking-wider">Setlist Presets</h3>
          </div>

          <div className="flex flex-col gap-2 max-h-[220px] overflow-y-auto pr-1">
            {presets.map((preset) => {
              const isActive = preset.id === editingPresetId;
              const isBuiltIn = ['standard', 'blues', 'jazz'].includes(preset.id);
              return (
                <button
                  key={preset.id}
                  onClick={() => handleSelectPreset(preset.id)}
                  className={`flex items-center justify-between text-left p-2.5 rounded-xl text-xs border transition-all duration-200 cursor-pointer font-mono uppercase tracking-wide active:scale-97 ${
                    isActive
                      ? 'border-[#00FF41] bg-[#00FF41]/10 text-[#00FF41] font-bold shadow-[0_0_12px_rgba(0,255,65,0.15)]'
                      : 'border-white/5 bg-black/20 text-zinc-400 hover:bg-white/5 hover:text-white hover:border-white/10'
                  }`}
                >
                  <span className="truncate pr-2">{preset.name}</span>
                  {!isBuiltIn && (
                    <button
                      onClick={(e) => handleDeletePreset(preset.id, e)}
                      className="p-1 text-zinc-500 hover:text-[#FF4444] hover:bg-white/5 rounded-lg transition"
                      title="Delete Preset"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </button>
              );
            })}
          </div>

          {/* New Preset Form */}
          <form onSubmit={handleCreatePreset} className="border-t border-white/5 pt-3 mt-1 flex flex-col gap-2">
            <span className="text-[10px] uppercase font-mono font-bold text-[#8E9299] tracking-wider">Save Current to New Set</span>
            <div className="flex gap-1.5">
              <input
                type="text"
                placeholder="e.g. Song 3 A-Minor"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                className="flex-1 bg-black/40 border border-white/10 px-3 py-2 rounded-xl text-xs font-mono font-bold text-[#00FF41] placeholder-zinc-700 focus:outline-hidden focus:border-[#00FF41] transition-all"
              />
              <button
                type="submit"
                disabled={!newPresetName.trim()}
                className="p-2.5 bg-[#00FF41] hover:bg-[#22ff5a] disabled:bg-white/5 disabled:text-zinc-650 text-black rounded-xl font-bold transition-all duration-200 flex items-center justify-center cursor-pointer active:scale-95"
                title="Add New Preset"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>

        {/* Mappings Table */}
        <div className="flex-1 bg-white/[0.01] backdrop-blur-md border border-white/5 rounded-2xl overflow-hidden shadow-xl relative">
          <div className="absolute top-0 left-4 right-4 h-[1px] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
          <div className="p-4 bg-black/10 border-b border-white/5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-[#00FF41]" />
              <div>
                <h3 className="font-mono font-bold text-xs uppercase text-white tracking-wider">Configure Chord Mappings</h3>
                <p className="text-3xs text-[#8E9299]">Edit values below to change what chords are sent live.</p>
              </div>
            </div>
            
            {/* Save Current mappings change */}
            <button
              onClick={handleSaveCurrentPreset}
              className="flex items-center justify-center gap-1.5 px-4 py-2 bg-[#00FF41] hover:bg-[#22ff5a] active:scale-95 text-black text-xs font-mono font-bold rounded-xl shadow-[0_4px_12px_rgba(0,255,65,0.2)] transition-all duration-200 self-start sm:self-auto cursor-pointer uppercase tracking-wider"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Changes</span>
            </button>
          </div>

          <div className="p-4 md:p-5 bg-transparent">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {GESTURES.map((gesture) => {
                const currentMap = editMappings.find((m) => m.gestureId === gesture.id);
                return (
                  <div
                    key={gesture.id}
                    className="flex items-center justify-between p-3 bg-black/10 border border-white/5 hover:border-white/10 rounded-xl gap-3 transition-all duration-200"
                  >
                    <div className="flex items-center gap-3">
                      <div className="text-xl bg-black/40 p-2 rounded-xl border border-white/5 w-11 h-11 flex items-center justify-center shadow-inner">
                        {gesture.emoji}
                      </div>
                      <div>
                        <span className="text-xs font-mono font-bold text-white block uppercase tracking-wide">{gesture.name}</span>
                        <span className="text-[10px] font-mono text-[#8E9299] block leading-tight mt-0.5">{gesture.description}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 max-w-[120px]">
                      <ArrowRight className="w-3 h-3 text-zinc-600 shrink-0" />
                      <input
                        type="text"
                        value={currentMap?.chord || ''}
                        onChange={(e) => handleChordChange(gesture.id, e.target.value)}
                        placeholder="Chord"
                        maxLength={10}
                        className="w-full text-center bg-black/30 border border-white/10 hover:border-white/20 focus:border-[#00FF41] rounded-lg px-2 py-2 font-mono text-xs font-bold text-[#00FF41] placeholder-zinc-700 focus:outline-hidden uppercase transition-all"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 p-4 bg-white/[0.02] border border-white/5 rounded-xl flex items-start gap-2.5 shadow-md">
              <Info className="w-4 h-4 text-[#00FF41] shrink-0 mt-0.5" />
              <p className="text-4xs text-[#8E9299] font-mono uppercase tracking-widest leading-relaxed">
                These mappings dictate both the active hand gestures AND the backup buttons on the manual dashboard. 
                Type any text label (like <span className="font-bold text-white">Am</span>, <span className="font-bold text-white">C#maj7</span>, or <span className="font-bold text-white">G/B</span>) up to 10 characters.
              </p>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
