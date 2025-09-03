import React, { useState, useEffect, useRef, FormEvent, FC, ReactNode, ChangeEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Content } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const SIMPLE_SYSTEM_INSTRUCTION = "You are a helpful and friendly AI assistant. Provide clear, concise, and accurate responses to the user's query.";

interface AgentResponse {
  agentName: string;
  text: string;
}

interface Message {
  role: 'user' | 'model';
  parts: { text: string }[];
  agent?: string;
  agentResponses?: AgentResponse[];
  isExpanded?: boolean;
}

interface AgentSettings {
  id: string;
  name:string;
  systemInstruction: string;
  contextMessages: number; // 0 for all
  model: 'flash' | 'pro';
  order: number;
  connections: string[];
  position: { x: number, y: number };
}

const DEFAULT_AGENT_SETTINGS: AgentSettings[] = [
  { id: 'default-1', name: 'Analyst', systemInstruction: 'You are a meticulous analyst. Break down the user query into its core components. Provide a data-driven, logical, and factual response. Avoid speculation and focus on verifiable information.', contextMessages: 0, model: 'flash', order: 1, connections: ['default-4'], position: { x: 50, y: 20 } },
  { id: 'default-2', name: 'Creative', systemInstruction: 'You are an innovative thinker. Brainstorm creative approaches, analogies, and out-of-the-box ideas related to the user query. Don\'t be afraid to be imaginative.', contextMessages: 0, model: 'flash', order: 1, connections: ['default-4'], position: { x: 50, y: 340 } },
  { id: 'default-3', name: 'Critic', systemInstruction: 'You are a skeptical critic. Identify potential flaws, risks, counterarguments, and unintended consequences related to the user\'s query and potential solutions. Your goal is to challenge assumptions.', contextMessages: 0, model: 'flash', order: 1, connections: ['default-4'], position: { x: 50, y: 660 } },
  { id: 'default-4', name: 'Synthesizer', systemInstruction: 'You are a master synthesizer. Your task is to review the inputs from multiple specialist agents. Integrate their perspectives to construct a single, final, well-rounded, and balanced response for the user. Address the user\'s original query directly, incorporating the strengths of each agent\'s contribution.', contextMessages: 0, model: 'flash', order: 2, connections: [], position: { x: 450, y: 340 } }
];

const CodeBlock: FC<{ children?: ReactNode }> = ({ children }) => {
  const [copied, setCopied] = useState(false);
  const textToCopy = String(children).replace(/\n$/, '');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <div className="code-block-wrapper">
      <pre><code>{children}</code></pre>
      <button onClick={handleCopy} className="copy-button" aria-label="Copy code">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
          {copied ? (
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
          ) : (
            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-5zm0 16H8V7h11v14z"/>
          )}
        </svg>
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
};

const LoadingIndicator: FC<{ status: string; time: number; barCount: number; stageClass: string }> = ({ status, time, barCount, stageClass }) => {
  return (
    <div className="loading-animation">
      <div className="loading-header">
        <span className="loading-status">{status}</span>
        <span className="timer-display">{(time / 1000).toFixed(1)}s</span>
      </div>
      <div className={`progress-bars-container ${stageClass}`}>
        {Array.from({ length: barCount }).map((_, i) => (
          <div key={i} className="progress-bar" style={{ animationDelay: `${i * 0.2}s` }}></div>
        ))}
      </div>
    </div>
  );
};

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AgentSettings[];
  onUpdateSettings: (newSettings: AgentSettings[]) => void;
}

const AgentFormView: FC<Omit<SettingsModalProps, 'isOpen' | 'onClose'>> = ({ settings, onUpdateSettings }) => {
  const handleInputChange = (id: string, field: keyof Omit<AgentSettings, 'id' | 'connections' | 'position'>, value: string | number) => {
    onUpdateSettings(settings.map(agent => {
      if (agent.id === id) {
        if ((field === 'contextMessages' || field === 'order') && typeof value === 'string') {
          return { ...agent, [field]: parseInt(value, 10) || (field === 'order' ? 1 : 0) };
        }
        return { ...agent, [field]: value };
      }
      return agent;
    }));
  };

  return (
    <div className="form-view-grid">
      {settings.map((agent) => (
        <div key={agent.id} className="agent-settings-card">
          <div className="agent-card-header">
            <h3>Agent: {agent.name}</h3>
          </div>
          <div className="form-group">
            <label htmlFor={`agent-name-${agent.id}`}>Agent Name</label>
            <input id={`agent-name-${agent.id}`} type="text" value={agent.name} onChange={(e) => handleInputChange(agent.id, 'name', e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor={`agent-prompt-${agent.id}`}>System Prompt</label>
            <textarea id={`agent-prompt-${agent.id}`} value={agent.systemInstruction} onChange={(e) => handleInputChange(agent.id, 'systemInstruction', e.target.value)} rows={5}></textarea>
          </div>
          <div className="form-group-inline">
            <div className="form-group">
              <label htmlFor={`agent-context-${agent.id}`}>Context History</label>
              <input id={`agent-context-${agent.id}`} type="number" value={agent.contextMessages} onChange={(e) => handleInputChange(agent.id, 'contextMessages', e.target.value)} min="0" />
              <span>(0 for all)</span>
            </div>
            <div className="form-group">
              <label htmlFor={`agent-order-${agent.id}`}>Order</label>
              <input id={`agent-order-${agent.id}`} type="number" value={agent.order} onChange={(e) => handleInputChange(agent.id, 'order', e.target.value)} min="1" />
            </div>
            <div className="form-group">
              <label htmlFor={`agent-model-${agent.id}`}>Model</label>
              <select id={`agent-model-${agent.id}`} value={agent.model} onChange={(e) => handleInputChange(agent.id, 'model', e.target.value)}>
                <option value="flash">Flash</option>
                <option value="pro">Pro</option>
              </select>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

const AgentGraphView: FC<Omit<SettingsModalProps, 'isOpen' | 'onClose'>> = ({ settings, onUpdateSettings }) => {
    const graphRef = useRef<HTMLDivElement>(null);
    const [draggedNode, setDraggedNode] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
    const [drawingLine, setDrawingLine] = useState<{ fromId: string; to: { x: number; y: number } } | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

    const handleNodeMouseDown = (e: React.MouseEvent<HTMLDivElement>, id: string) => {
        if ((e.target as HTMLElement).closest('.form-group, .agent-card-header, .remove-agent-button')) {
            return;
        }
        e.preventDefault();
        const node = e.currentTarget;
        const rect = node.getBoundingClientRect();
        setDraggedNode({
            id,
            offsetX: e.clientX - rect.left,
            offsetY: e.clientY - rect.top,
        });
    };
    
    const handlePortMouseDown = (e: React.MouseEvent<HTMLDivElement>, fromId: string) => {
        e.stopPropagation();
        const graphRect = graphRef.current!.getBoundingClientRect();
        const portRect = e.currentTarget.getBoundingClientRect();
        const startX = portRect.left - graphRect.left + portRect.width / 2 + graphRef.current!.scrollLeft;
        const startY = portRect.top - graphRect.top + portRect.height / 2 + graphRef.current!.scrollTop;
        
        setDrawingLine({ fromId, to: { x: startX, y: startY } });
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        const graphRect = graphRef.current!.getBoundingClientRect();
        const x = e.clientX - graphRect.left + graphRef.current!.scrollLeft;
        const y = e.clientY - graphRect.top + graphRef.current!.scrollTop;

        if (draggedNode) {
            onUpdateSettings(settings.map(agent =>
                agent.id === draggedNode.id
                    ? { ...agent, position: { x: x - draggedNode.offsetX, y: y - draggedNode.offsetY } }
                    : agent
            ));
        }
        if (drawingLine) {
            setDrawingLine({ ...drawingLine, to: { x, y } });
        }
    };
    
    const handleMouseUp = () => {
        setDraggedNode(null);
        setDrawingLine(null);
    };

    const handleNodeMouseUp = (toId: string) => {
        if (drawingLine && drawingLine.fromId !== toId) {
            const fromAgent = settings.find(a => a.id === drawingLine.fromId);
            const toAgent = settings.find(a => a.id === toId);

            if (fromAgent && toAgent && fromAgent.order < toAgent.order) {
                onUpdateSettings(settings.map(agent => {
                    if (agent.id === fromAgent.id) {
                        if (!agent.connections.includes(toId)) {
                            return { ...agent, connections: [...agent.connections, toId] };
                        }
                    }
                    return agent;
                }));
            }
        }
    };
    
    const handleRemoveConnection = (fromId: string, toId: string) => {
       onUpdateSettings(settings.map(agent => 
           agent.id === fromId
               ? { ...agent, connections: agent.connections.filter(c => c !== toId) }
               : agent
       ));
    };

    const getPortPosition = (agentId: string, port: 'in' | 'out') => {
        const agent = settings.find(a => a.id === agentId);
        if (!agent) return { x: 0, y: 0 };
        const el = document.getElementById(`agent-node-${agentId}`);
        const elHeight = el ? el.clientHeight : 320;
        
        return {
            x: agent.position.x + (port === 'out' ? 320 : 0),
            y: agent.position.y + elHeight / 2,
        };
    };

    return (
        <div
            ref={graphRef}
            className="graph-view-container"
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
        >
            <svg className="connector-svg" style={{ width: 2000, height: 2000 }}>
                <defs>
                    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#5f6368" />
                    </marker>
                </defs>
                {settings.flatMap(agent =>
                    agent.connections.map(targetId => {
                        const fromPos = getPortPosition(agent.id, 'out');
                        const toPos = getPortPosition(targetId, 'in');
                        return (
                             <g key={`${agent.id}-${targetId}`} className="connection-line-group">
                                <line
                                    x1={fromPos.x} y1={fromPos.y}
                                    x2={toPos.x} y2={toPos.y}
                                    className="connection-line"
                                    markerEnd="url(#arrow)"
                                />
                                <line 
                                    x1={fromPos.x} y1={fromPos.y}
                                    x2={toPos.x} y2={toPos.y}
                                    className="connection-line-clickable"
                                    onClick={() => handleRemoveConnection(agent.id, targetId)}
                                />
                            </g>
                        );
                    })
                )}
                {drawingLine && (
                    <line
                        x1={getPortPosition(drawingLine.fromId, 'out').x}
                        y1={getPortPosition(drawingLine.fromId, 'out').y}
                        x2={drawingLine.to.x}
                        y2={drawingLine.to.y}
                        className="connection-line drawing"
                        markerEnd="url(#arrow)"
                    />
                )}
            </svg>

            {settings.map(agent => {
                const isHovered = hoveredNodeId === agent.id;
                let portInClass = 'connection-port port-in';
                if (drawingLine && isHovered && drawingLine.fromId !== agent.id) {
                    const fromAgent = settings.find(a => a.id === drawingLine.fromId);
                    const toAgent = agent;
                    if (fromAgent && toAgent && fromAgent.order < toAgent.order) {
                        portInClass += ' valid';
                    } else {
                        portInClass += ' invalid';
                    }
                }

                return (
                    <div
                        id={`agent-node-${agent.id}`}
                        key={agent.id}
                        className={`agent-node ${draggedNode?.id === agent.id ? 'dragging' : ''}`}
                        style={{ left: agent.position.x, top: agent.position.y }}
                        onMouseDown={(e) => handleNodeMouseDown(e, agent.id)}
                        onMouseUp={() => handleNodeMouseUp(agent.id)}
                        onMouseEnter={() => setHoveredNodeId(agent.id)}
                        onMouseLeave={() => setHoveredNodeId(null)}
                    >
                        <div className={portInClass}></div>
                        <div className="connection-port port-out" onMouseDown={(e) => handlePortMouseDown(e, agent.id)}></div>
                        <div className="agent-settings-card">
                        <div className="agent-card-header">
                            <h3>Agent: {agent.name}</h3>
                        </div>
                        <div className="form-group">
                            <label>Agent Name</label>
                            <input type="text" value={agent.name} onChange={(e) => onUpdateSettings(settings.map(a => a.id === agent.id ? {...a, name: e.target.value} : a))} />
                        </div>
                        <div className="form-group">
                            <label>System Prompt</label>
                            <textarea value={agent.systemInstruction} onChange={(e) => onUpdateSettings(settings.map(a => a.id === agent.id ? {...a, systemInstruction: e.target.value} : a))} rows={3}></textarea>
                        </div>
                        <div className="form-group-inline">
                            <div className="form-group">
                                <label>Context</label>
                                <input type="number" value={agent.contextMessages} onChange={(e) => onUpdateSettings(settings.map(a => a.id === agent.id ? {...a, contextMessages: parseInt(e.target.value, 10)} : a))} min="0" />
                            </div>
                            <div className="form-group">
                                <label>Order</label>
                                <input type="number" value={agent.order} onChange={(e) => onUpdateSettings(settings.map(a => a.id === agent.id ? {...a, order: parseInt(e.target.value, 10)} : a))} min="1" />
                            </div>
                            <div className="form-group">
                                <label>Model</label>
                                <select value={agent.model} onChange={(e) => onUpdateSettings(settings.map(a => a.id === agent.id ? {...a, model: e.target.value as 'flash' | 'pro'} : a))}>
                                    <option value="flash">Flash</option>
                                    <option value="pro">Pro</option>
                                </select>
                            </div>
                        </div>
                        </div>
                    </div>
                )
            })}
        </div>
    );
};


const SettingsModal: FC<SettingsModalProps> = ({ isOpen, onClose, settings, onUpdateSettings }) => {
  const [localSettings, setLocalSettings] = useState<AgentSettings[]>([]);
  const [view, setView] = useState<'form' | 'graph'>('form');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  useEffect(() => {
    if (isOpen) {
      setLocalSettings(JSON.parse(JSON.stringify(settings)));
    }
  }, [settings, isOpen]);

  
  const handleAddAgent = () => {
    const newAgentOrder = 1;
    const targetsForNewAgent = localSettings.filter(a => a.order === newAgentOrder + 1).map(a => a.id);

    const newAgent: AgentSettings = {
      id: `agent-${Date.now()}`,
      name: 'New Agent',
      systemInstruction: 'Define the role and focus for this agent.',
      contextMessages: 0,
      model: 'flash',
      order: 1,
      connections: targetsForNewAgent,
      position: {x: 20, y: 20},
    };
    setLocalSettings(prev => [...prev, newAgent]);
  };

  const handleRemoveAgent = (idToRemove: string) => {
    setLocalSettings(prev => {
        let updated = prev.filter(agent => agent.id !== idToRemove);
        updated = updated.map(agent => ({
          ...agent,
          connections: agent.connections.filter(connId => connId !== idToRemove),
        }));

        if (updated.length === 0) {
            const newAgent: AgentSettings = {
              id: `agent-${Date.now()}`,
              name: 'New Agent',
              systemInstruction: 'Define the role and focus for this agent.',
              contextMessages: 0,
              model: 'flash',
              order: 1,
              connections: [],
              position: {x: 20, y: 20},
            };
            return [newAgent];
        }
        return updated;
    });
  };

  const handleSave = () => {
    onUpdateSettings(localSettings);
    onClose();
  };

  const handleSavePreset = () => {
    if (localSettings.length === 0) {
      alert("There are no agents to save.");
      return;
    }
    const dataStr = JSON.stringify(localSettings, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.download = 'multi-agent-preset.json';
    link.href = url;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleLoadPresetClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (window.confirm("Do you want to save your current agent setup to a file before loading a new one?")) {
        handleSavePreset();
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result;
        if (typeof text !== 'string') {
          throw new Error('File content is not readable.');
        }
        const parsedSettings = JSON.parse(text);

        if (Array.isArray(parsedSettings) && parsedSettings.every(s => s.id && s.name && s.systemInstruction !== undefined)) {
          setLocalSettings(parsedSettings);
        } else {
          alert('Invalid preset file format. Please select a valid agent configuration file.');
        }
      } catch (error) {
        console.error("Failed to parse preset file:", error);
        alert('Failed to load preset. The file might be corrupted or not in the correct JSON format.');
      }
    };
    reader.onerror = () => {
      alert('Error reading the file.');
    };
    reader.readAsText(file);
    event.target.value = '';
  };
  
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={e => e.stopPropagation()}>
            <input 
              type="file" 
              ref={fileInputRef} 
              style={{ display: 'none' }} 
              onChange={handleFileChange} 
              accept="application/json,.json"
            />
            <div className="modal-header">
                <h2>Heavy Mode Settings</h2>
                <div className="modal-header-controls">
                  <button onClick={() => setView(view === 'form' ? 'graph' : 'form')} className="view-toggle-button" aria-label={`Switch to ${view === 'form' ? 'graph' : 'form'} view`}>
                    {view === 'form' ? (
                       <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M17 7H9.41l2.3 2.3c.78.78.78 2.05 0 2.83l-2.3 2.3H17v-2h-4v-2h4V7zM3 3v2h4V3H3zm0 16v2h4v-2H3zm0-8v2h4v-2H3zm16 8v2h4v-2h-4zm0-16v2h4V3h-4zm0 8v2h4v-2h-4z"/></svg>
                    ) : (
                       <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M4 8h4V4H4v4zm6 12h4v-4h-4v4zm-6 0h4v-4H4v4zm0-6h4v-4H4v4zm6 0h4v-4h-4v4zm6-10v4h4V4h-4zm-6 4h4V4h-4v4zm6 6h4v-4h-4v4zm0 6h4v-4h-4v4z"/></svg>
                    )}
                  </button>
                  <button onClick={onClose} className="close-button" aria-label="Close settings">&times;</button>
                </div>
            </div>
            <div className="modal-body">
                {view === 'form' ? (
                  <div className="form-view-grid">
                      {localSettings.map(agent => (
                          <div key={agent.id} className="agent-settings-card-container">
                              <AgentFormView settings={[agent]} onUpdateSettings={(updatedAgent) => setLocalSettings(localSettings.map(a => a.id === updatedAgent[0].id ? updatedAgent[0] : a))} />
                              <button onClick={() => handleRemoveAgent(agent.id)} className="remove-agent-button-standalone" aria-label={`Remove ${agent.name} agent`}>&times;</button>
                          </div>
                      ))}
                  </div>
                ) : (
                  <AgentGraphView settings={localSettings} onUpdateSettings={setLocalSettings} />
                )}
            </div>
            <div className="modal-footer">
                <div className="modal-footer-left">
                  <button onClick={handleAddAgent} className="add-agent-button">Add Agent</button>
                  <button onClick={handleLoadPresetClick} className="preset-button">Load Preset</button>
                  <button onClick={handleSavePreset} className="preset-button">Save Preset</button>
                </div>
                <button onClick={handleSave} className="save-button">Save Changes</button>
            </div>
        </div>
    </div>
  );
};

// Maps the user-facing model selection to the actual Gemini model name.
const getModelName = (modelSelection: 'flash' | 'pro'): string => {
  return  modelSelection === "pro" ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
};

const AgentResponsesView: FC<{ responses: AgentResponse[] }> = ({ responses }) => {
  const [activeTabIndex, setActiveTabIndex] = useState(0);

  if (!responses || responses.length === 0) {
    return null;
  }

  const activeTab = responses[activeTabIndex] ? activeTabIndex : 0;
  const activeResponse = responses[activeTab];

  return (
    <div className="agent-responses-container">
      <div className="agent-tabs" role="tablist" aria-label="Agent Responses">
        {responses.map((response, index) => (
          <button
            key={index}
            role="tab"
            aria-selected={index === activeTab}
            aria-controls={`agent-panel-${index}`}
            id={`agent-tab-${index}`}
            className={`agent-tab ${index === activeTab ? 'active' : ''}`}
            onClick={() => setActiveTabIndex(index)}
          >
            {response.agentName}
          </button>
        ))}
      </div>
      {activeResponse && (
        <div
          className="agent-response-content"
          role="tabpanel"
          id={`agent-panel-${activeTab}`}
          aria-labelledby={`agent-tab-${activeTab}`}
          tabIndex={0}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code(props) {
                const { children } = props;
                return <CodeBlock>{String(children)}</CodeBlock>;
              },
            }}
          >
            {activeResponse.text}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
};


const App: FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingStatus, setLoadingStatus] = useState<string>('');
  const [loadingBarCount, setLoadingBarCount] = useState(1);
  const [loadingStageClass, setLoadingStageClass] = useState('light');
  const [timer, setTimer] = useState<number>(0);
  const [isHeavyMode, setIsHeavyMode] = useState<boolean>(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [agentSettings, setAgentSettings] = useState<AgentSettings[]>(DEFAULT_AGENT_SETTINGS);
  const messageListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [messages, isLoading]);
  
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isLoading) {
      interval = setInterval(() => {
        setTimer(prevTime => prevTime + 100);
      }, 100);
    } else {
      setTimer(0);
    }
    return () => clearInterval(interval);
  }, [isLoading]);

  const handleToggleResponses = (messageIndex: number) => {
    setMessages(prevMessages =>
      prevMessages.map((msg, index) =>
        index === messageIndex ? { ...msg, isExpanded: !msg.isExpanded } : msg
      )
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const userInput = formData.get('userInput') as string;
    event.currentTarget.reset();
    if (!userInput.trim()) return;

    const userMessage: Message = { role: 'user', parts: [{ text: userInput }] };
    const currentMessages = [...messages, userMessage];
    setMessages(currentMessages);
    setIsLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      
      const chatHistory: Content[] = currentMessages.slice(0, -1).map(msg => ({
        role: msg.role,
        parts: msg.parts,
      }));
      
      if (isHeavyMode) {
        const agentsByOrder = agentSettings.reduce<Record<number, AgentSettings[]>>((acc, agent) => {
            const order = agent.order;
            if (!acc[order]) acc[order] = [];
            acc[order].push(agent);
            return acc;
        }, {});

        const sortedOrders = Object.keys(agentsByOrder).map(Number).sort((a, b) => a - b);
        
        const agentOutputs: Record<string, AgentResponse> = {};
        const allAgentResponses: AgentResponse[] = [];

        for (const order of sortedOrders) {
            setLoadingStatus(`Executing Order ${order}...`);
            const currentOrderAgents = agentsByOrder[order];
            setLoadingBarCount(currentOrderAgents.length);
            setLoadingStageClass('deliberating');

            const agentPromises = currentOrderAgents.map(agent => {
                const parentAgents = agentSettings.filter(parent => parent.connections.includes(agent.id));
                const parentResults = parentAgents
                  .map(p => agentOutputs[p.id])
                  .filter(Boolean);

                let currentInputText = userInput;
                if (parentResults.length > 0) {
                    const previousResults = parentResults.map(o => `${o.agentName}'s Output:\n"${o.text}"`).join('\n\n');
                    currentInputText = `The original user query was: "${userInput}".\n\nBased on your role, analyze the following inputs from other agents:\n\n${previousResults}\n\nNow, perform your task.`;
                }

                const currentUserTurn: Content = { role: 'user', parts: [{ text: currentInputText }] };
                const historySlice = agent.contextMessages > 0 ? chatHistory.slice(-agent.contextMessages) : chatHistory;
                
                return ai.models.generateContent({
                    model: getModelName(agent.model),
                    contents: [...historySlice, currentUserTurn],
                    config: { systemInstruction: agent.systemInstruction },
                }).then(res => ({ agentId: agent.id, agentName: agent.name, text: res.text }));
            });

            const currentOrderResults = await Promise.all(agentPromises);
            
            currentOrderResults.forEach(result => {
                agentOutputs[result.agentId] = { agentName: result.agentName, text: result.text };
            });
            allAgentResponses.push(...currentOrderResults);
        }
        
        const finalAgents = agentSettings.filter(a => a.connections.length === 0);
        const finalAgentNames = finalAgents.map(a => a.name);
        const finalOutputs = Object.values(agentOutputs).filter(o => finalAgentNames.includes(o.agentName));

        const finalResponseText = finalOutputs.length > 0
            ? (finalOutputs.length > 1 ? finalOutputs.map(o => `--- ${o.agentName} ---\n${o.text}`).join('\n\n') : finalOutputs[0].text)
            : "No final output was generated by designated final agents.";

        const finalMessage: Message = { 
          role: 'model', 
          parts: [{ text: finalResponseText }], 
          agent: 'Multi-Agent Response',
          agentResponses: allAgentResponses,
          isExpanded: false,
        };
        setMessages(prev => [...prev, finalMessage]);

      } else { // Light Mode: Single agent response
        setLoadingStatus('Generating response...');
        setLoadingBarCount(1);
        setLoadingStageClass('light');
        const currentUserTurn: Content = { role: 'user', parts: [{ text: userInput }] };
        const result = await ai.models.generateContent({
          model: getModelName('pro'),
          contents: [...chatHistory, currentUserTurn],
          config: { systemInstruction: SIMPLE_SYSTEM_INSTRUCTION },
        });
        
        const responseText = result.text;
        const finalMessage: Message = { role: 'model', parts: [{ text: responseText }], agent: 'Gemini' };
        setMessages(prev => [...prev, finalMessage]);
      }

    } catch (error) {
      console.error('Error sending message to agents:', error);
      const errorMessage: Message = { role: 'model', parts: [{ text: 'Sorry, I encountered an error. Please try again.' }], agent: 'System' };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
        setIsLoading(false);
    }
  };

  return (
    <div className="chat-container">
      <header>
        <h1>Multi-Agent Chat</h1>
        <div className="header-controls">
            <div className="mode-toggle">
                <label htmlFor="heavy-mode-switch">Heavy Mode</label>
                <label className="toggle-switch">
                  <input
                    id="heavy-mode-switch"
                    type="checkbox"
                    checked={isHeavyMode}
                    onChange={() => setIsHeavyMode(!isHeavyMode)}
                    disabled={isLoading}
                  />
                  <span className="slider"></span>
                </label>
            </div>
            <button onClick={() => setIsSettingsModalOpen(true)} className="settings-button" disabled={isLoading} aria-label="Heavy Mode Settings">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/>
                </svg>
            </button>
        </div>
      </header>
      <div className="message-list" ref={messageListRef}>
        {messages.map((msg, index) => {
          const isMultiAgent = msg.agentResponses && msg.agentResponses.length > 0;
          return (
            <div key={index} className={`message ${msg.role}`}>
              {msg.agent && (
                <div className="message-header">
                  <span className="agent-label">{msg.agent}</span>
                  {isMultiAgent && (
                    <button
                      onClick={() => handleToggleResponses(index)}
                      className={`toggle-responses-button ${msg.isExpanded ? 'expanded' : ''}`}
                      aria-expanded={msg.isExpanded}
                      aria-controls={`agent-responses-${index}`}
                      aria-label="View agent details"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                      </svg>
                    </button>
                  )}
                </div>
              )}

              {isMultiAgent && msg.isExpanded && (
                <div id={`agent-responses-${index}`}>
                  <AgentResponsesView responses={msg.agentResponses} />
                </div>
              )}
              
              {isMultiAgent && <h4 className="final-response-header">Final Response</h4>}
              
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code(props) {
                    const { children } = props;
                    return <CodeBlock>{String(children)}</CodeBlock>;
                  },
                }}
              >
                {msg.parts[0].text}
              </ReactMarkdown>
            </div>
          );
        })}
        {isLoading && <LoadingIndicator status={loadingStatus} time={timer} barCount={loadingBarCount} stageClass={loadingStageClass} />}
      </div>
      <form className="input-area" onSubmit={handleSubmit}>
        <input
          type="text"
          name="userInput"
          placeholder="Ask the agents..."
          aria-label="User input"
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading} aria-label="Send message">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
        </button>
      </form>
      <SettingsModal 
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={agentSettings}
        onUpdateSettings={setAgentSettings}
      />
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);