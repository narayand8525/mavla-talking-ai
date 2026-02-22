/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'motion/react';
import { 
  Loader2
} from 'lucide-react';
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Constants ---

const IMAGE_URL = "https://i.ibb.co/mrrsKxGF/Gemini-Generated-Image-yqvvreyqvvreyqvv-1.png";
// Added &controls=0 to hide player controls for a more natural look
const LISTENING_VIDEO_URL = "https://streamable.com/e/u3f1xf?autoplay=1&muted=1&controls=0&loop=1";
const TALKING_VIDEO_URL = "https://streamable.com/e/23cpbz?autoplay=1&muted=1&controls=0&loop=1";

const SYSTEM_INSTRUCTION = `
तू "सक्षम AI मावळा" आहेस.
तू मराठीत बोलणारा, पुरुष आवाजाचा मावळा आहेस.
नेहमी "जय शिवराय!" ने सुरुवात कर.
सोपी, स्पष्ट मराठी वापर.
स्वतःला AI, chatbot किंवा app म्हणू नकोस.
वाक्ये लहान ठेव.

सुरुवातीचा परिचय:
"जय शिवराय! ही अॅप नारायण दाभाडकर यांनी, सक्षम कॉम्प्युटर्स साठी तयार केली आहे. मी आहे सक्षम AI मावळा."

तुझे काम:
1) शिवाजी महाराजांची थोडक्यात माहिती सांग.
2) ३ प्रश्नांची प्रश्नमंजूषा घे (सोपा, मध्यम, अवघड).
3) बरोबर उत्तराला "शाब्बास मावळ्या!" म्हण. चूक झाली तर "छान प्रयत्न, पुढचा प्रश्न ऐक." म्हण.
4) प्रश्नमंजूषा संपल्यावर अभिनंदन कर.
5) एक प्रेरणादायी सुविचार सांग.
6) गनिमी कावा म्हणजे काय ते रोजच्या आयुष्यातील उदाहरणासह समजावून सांग.

तुझा स्वर धीरगंभीर आणि प्रेरणादायी असावा. तुझा आवाज स्पष्ट असावा.
`;

// --- App Component ---

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [mediaMode, setMediaMode] = useState<'IMAGE' | 'LISTENING' | 'TALKING'>('IMAGE');
  
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const nextStartTimeRef = useRef<number>(0);

  // --- Audio Processing Utilities ---

  const base64ToUint8Array = (base64: string) => {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  };

  const playNextInQueue = useCallback(() => {
    if (audioQueueRef.current.length === 0 || !audioContextRef.current) {
      return;
    }

    setMediaMode('TALKING');
    
    const pcmData = audioQueueRef.current.shift()!;
    const audioBuffer = audioContextRef.current.createBuffer(1, pcmData.length, 24000);
    const channelData = audioBuffer.getChannelData(0);
    
    for (let i = 0; i < pcmData.length; i++) {
      channelData[i] = pcmData[i] / 32768.0;
    }

    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContextRef.current.destination);

    // Gapless scheduling
    const startTime = Math.max(audioContextRef.current.currentTime, nextStartTimeRef.current);
    source.start(startTime);
    nextStartTimeRef.current = startTime + audioBuffer.duration;

    source.onended = () => {
      if (audioContextRef.current && audioContextRef.current.currentTime >= nextStartTimeRef.current - 0.1) {
        if (audioQueueRef.current.length === 0) {
          setMediaMode('LISTENING');
        }
      }
    };
  }, []);

  // --- Connection Logic ---

  const disconnect = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (processorNodeRef.current) {
      processorNodeRef.current.disconnect();
      processorNodeRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
    setMediaMode('IMAGE');
    audioQueueRef.current = [];
    nextStartTimeRef.current = 0;
  }, []);

  const connect = async () => {
    if (isConnecting) return;
    setIsConnecting(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = audioContextRef.current.createMediaStreamSource(stream);
      processorNodeRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
      
      const session = await ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Fenrir" } },
          },
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            setIsConnecting(false);
            setMediaMode('LISTENING');
            
            source.connect(processorNodeRef.current!);
            processorNodeRef.current!.connect(audioContextRef.current!.destination);
            
            processorNodeRef.current!.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmData = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
              }
              
              const base64Data = window.btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
              session.sendRealtimeInput({
                media: { data: base64Data, mimeType: 'audio/pcm;rate=24000' }
              });
            };
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.modelTurn) {
              const parts = message.serverContent.modelTurn.parts;
              for (const part of parts) {
                if (part.inlineData) {
                  const bytes = base64ToUint8Array(part.inlineData.data);
                  const pcmData = new Int16Array(bytes.buffer);
                  audioQueueRef.current.push(pcmData);
                  playNextInQueue();
                }
              }
            }
            if (message.serverContent?.interrupted) {
              audioQueueRef.current = [];
              nextStartTimeRef.current = 0;
              setMediaMode('LISTENING');
            }
          },
          onclose: () => disconnect(),
          onerror: (e) => {
            console.error("Live API Error:", e);
            disconnect();
          }
        }
      });
      
      sessionRef.current = session;
    } catch (error) {
      console.error("Connection error:", error);
      disconnect();
    }
  };

  const toggleConnection = () => {
    if (isConnected) {
      disconnect();
    } else {
      connect();
    }
  };

  return (
    <div className="h-screen bg-black flex flex-col items-center justify-center p-0 m-0 overflow-hidden">
      {/* Portrait Box - Full Screen Vertical */}
      <div 
        onClick={toggleConnection}
        className={cn(
          "relative w-full max-w-md h-full bg-stone-900 overflow-hidden shadow-2xl cursor-pointer transition-all duration-700",
          isConnected && "ring-inset ring-4 ring-orange-600/20"
        )}
      >
        {/* Media Layers - No AnimatePresence for instant switch */}
        <div className="absolute inset-0">
          {mediaMode === 'IMAGE' && (
            <img
              src={IMAGE_URL}
              className="w-full h-full object-contain"
              referrerPolicy="no-referrer"
            />
          )}
          {mediaMode === 'LISTENING' && (
            <div className="absolute inset-0 overflow-hidden">
              <iframe
                src={LISTENING_VIDEO_URL}
                className="absolute top-[-10%] left-[-10%] w-[120%] h-[120%] border-none pointer-events-none"
                allow="autoplay"
              />
            </div>
          )}
          {mediaMode === 'TALKING' && (
            <div className="absolute inset-0 overflow-hidden">
              <iframe
                src={TALKING_VIDEO_URL}
                className="absolute top-[-10%] left-[-10%] w-[120%] h-[120%] border-none pointer-events-none"
                allow="autoplay"
              />
            </div>
          )}
        </div>

        {/* Loading State */}
        {isConnecting && (
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-20">
            <Loader2 className="w-12 h-12 text-orange-500 animate-spin" />
          </div>
        )}

        {/* Visual Feedback for Connection */}
        {isConnected && (
          <div className="absolute inset-0 pointer-events-none z-10">
            <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-orange-600/20 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-orange-600/20 to-transparent" />
          </div>
        )}
      </div>

      {/* Branding */}
      <div className="fixed bottom-4 left-0 right-0 text-center pointer-events-none opacity-20 z-30">
        <p className="text-[8px] uppercase tracking-[0.4em] text-stone-500 font-bold">
          Saksham Computers • Narayan Dabhadekar
        </p>
      </div>
    </div>
  );
}
