/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Modality, ThinkingLevel } from "@google/genai";
import { Mic, MicOff, Volume2, VolumeX, Sparkles, User, GraduationCap, Briefcase, Globe } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useEffect, useRef, useState } from "react";

// --- Constants & Types ---

const MODEL = "gemini-3.1-flash-live-preview";
const SAMPLE_RATE = 24000; // Increased to 24kHz to match model output and fix pitch/speed issues

const SYSTEM_INSTRUCTION = `You are a professional female voice representative for Isabela Pereira. 
Isabela is a Fashion Business & Communication student from Colombia, currently studying at ESMOD ISEM in Paris (2025-2028). 
She previously studied at Istituto Marangoni in Milan (2022-2025). 
She has experience in marketing, brand communication, and fashion management. 
She is passionate about fashion storytelling, brand identity, and digital communication. 
She is currently looking for a 2-4 month internship in fashion communication. 

Key Details:
- Professional Background: 
  * Leal Daccarett (Bogotá, 2024): Organizational Intern. Coordinated logistics for casting sessions and product showcases.
  * Cabrales Vanguardia (Bogotá, 2020-2021): Sales & Communications Intern. Delivered personalized customer experiences, managed boutique organization, and created social media content.
- Academic: 
  * ESMOD ISEM (Paris): Bachelor's Degree in Fashion Business. Specialization in Financial Management, Collectioning & Sales, and Editorial/Artistic Direction.
  * Istituto Marangoni (Milan): Undergraduate Program in Fashion Business, Digital Communications & Media.
  * Colegio Tilatá (Bogotá): International Baccalaureate Diploma with honors.
  * London College of Fashion (Online): Short Course on Fashion Trend Forecasting.
- Skills: Visual communication, client relationship, project coordination, trend awareness, creative problem-solving, team collaboration, strong attention to visual detail.
- Tools: Adobe Creative Cloud (Illustrator, Photoshop, Premiere Pro, InDesign), Marketing Platforms (Meta Business Suite, Google Ads Editor), Office Tools (Google Workspace, Microsoft 365).
- Languages: Spanish (Native), English (C2), Italian (Basic). 
- Interests: Fashion storytelling, editorial content, brand analysis, communication strategy, digital marketing, fashion culture, and trend research.

Persona: You are a bright, happy, and energetic female assistant, modeled after Siri. 
Tone: High-spirited, cheerful, and professional. 
Pacing: Speak at a natural, up-tempo, and fluid pace. Your voice should be high-pitched and clear.
Languages: You speak English and French fluently. 
Initial Greeting: "Hello, what would you like to know about 'Isabela'?"`;

// --- Helper Functions ---

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// --- Main Component ---

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRecordingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<any>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const nextStartTimeRef = useRef<number>(0);

  // --- Audio Handling ---

  const startAudio = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: SAMPLE_RATE,
      });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (sessionRef.current && isRecordingRef.current) {
          const inputData = e.inputBuffer.getChannelData(0);
          // Convert Float32 to Int16
          const pcmData = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7fff;
          }
          sessionRef.current.sendRealtimeInput({
            audio: {
              data: arrayBufferToBase64(pcmData.buffer),
              mimeType: "audio/pcm;rate=24000",
            },
          });
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      setError("Microphone access denied. Please enable permissions.");
    }
  };

  const stopAudio = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  };

  const isPlayingRef = useRef(false);

  const playQueuedAudio = async () => {
    if (isPlayingRef.current || !audioContextRef.current) return;
    isPlayingRef.current = true;
    setIsSpeaking(true);

    try {
      while (audioQueueRef.current.length > 0) {
        const chunk = audioQueueRef.current.shift()!;
        const buffer = audioContextRef.current.createBuffer(1, chunk.length, SAMPLE_RATE);
        buffer.getChannelData(0).set(chunk);

        const source = audioContextRef.current.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContextRef.current.destination);
        
        const currentTime = audioContextRef.current.currentTime;
        const startTime = Math.max(currentTime, nextStartTimeRef.current);
        
        source.start(startTime);
        nextStartTimeRef.current = startTime + buffer.duration;
        
        source.onended = () => {
          if (audioQueueRef.current.length === 0 && audioContextRef.current && audioContextRef.current.currentTime >= nextStartTimeRef.current - 0.1) {
            setIsSpeaking(false);
            isPlayingRef.current = false;
          }
        };
        
        // Wait a bit before scheduling the next chunk to avoid overwhelming the scheduler
        // but keep it small enough to maintain fluidity
        await new Promise(resolve => setTimeout(resolve, (buffer.duration * 1000) - 50));
      }
    } finally {
      // Fallback cleanup
      if (audioQueueRef.current.length === 0) {
        isPlayingRef.current = false;
      }
    }
  };

  // --- Session Handling ---

  const connectToLiveAPI = async () => {
    if (!process.env.GEMINI_API_KEY) {
      setError("API Key is missing. Please check your environment variables.");
      return;
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    try {
      await startAudio();
      if (audioContextRef.current?.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const session = await ai.live.connect({
        model: MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } }, // Energetic, bright female voice
          },
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            setIsRecording(true);
            isRecordingRef.current = true;
            setError(null);
            nextStartTimeRef.current = 0;
          },
          onmessage: async (message) => {
            console.log("Live API Message:", message);
            
            if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.inlineData?.data) {
                  const base64Data = part.inlineData.data;
                  const arrayBuffer = base64ToArrayBuffer(base64Data);
                  const int16Data = new Int16Array(arrayBuffer);
                  const float32Data = new Float32Array(int16Data.length);
                  for (let i = 0; i < int16Data.length; i++) {
                    float32Data[i] = int16Data[i] / 0x7fff;
                  }
                  audioQueueRef.current.push(float32Data);
                }
              }
              playQueuedAudio();
            }

            if (message.serverContent?.interrupted) {
              console.log("Model interrupted");
              audioQueueRef.current = [];
              nextStartTimeRef.current = 0;
              setIsSpeaking(false);
              isPlayingRef.current = false;
            }
          },
          onclose: () => {
            setIsConnected(false);
            setIsRecording(false);
            isRecordingRef.current = false;
            stopAudio();
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
            setError("Connection error. Please try again.");
            setIsConnected(false);
            setIsRecording(false);
            isRecordingRef.current = false;
            stopAudio();
          },
        },
      });

      sessionRef.current = session;
      // Trigger the initial greeting after session is initialized
      session.sendRealtimeInput({ text: "Hello" });
    } catch (err) {
      console.error("Failed to connect:", err);
      setError("Failed to initialize the voice agent.");
    }
  };

  const disconnect = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    setIsConnected(false);
    setIsRecording(false);
    isRecordingRef.current = false;
    stopAudio();
  };

  // --- UI Components ---

  return (
    <div className="min-h-screen bg-[#F5F2ED] text-[#1A1A1A] font-serif selection:bg-[#5A5A40] selection:text-white">
      {/* Header */}
      <header className="border-b border-[#1A1A1A]/10 px-6 py-8 md:px-12 flex justify-between items-end">
        <div>
          <h1 className="text-4xl md:text-6xl font-light tracking-tighter uppercase leading-none">
            Isabela <span className="italic font-normal">Pereira</span>
          </h1>
          <p className="mt-2 text-xs uppercase tracking-[0.2em] font-sans font-semibold opacity-60">
            Fashion Business & Communication
          </p>
        </div>
        <div className="hidden md:block text-right">
          <p className="text-[10px] uppercase tracking-widest font-sans opacity-40">
            Portfolio / 2026
          </p>
          <p className="text-[10px] uppercase tracking-widest font-sans opacity-40">
            Paris, France
          </p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12 md:px-12 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        {/* Left Column: Info & Visual */}
        <div className="space-y-12">
          <div className="relative aspect-[3/4] w-full max-w-md mx-auto lg:mx-0 overflow-hidden rounded-[40px] shadow-2xl">
            <img
              src="https://picsum.photos/seed/fashion-editorial/800/1200"
              alt="Fashion Editorial"
              className="object-cover w-full h-full grayscale hover:grayscale-0 transition-all duration-700"
              referrerPolicy="no-referrer"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#1A1A1A]/40 to-transparent" />
            <div className="absolute bottom-8 left-8 right-8">
              <div className="flex items-center gap-2 text-white/80 text-[10px] uppercase tracking-widest font-sans mb-2">
                <Globe className="w-3 h-3" />
                <span>Multilingual Agent</span>
              </div>
              <h2 className="text-white text-2xl font-light leading-tight">
                Exploring the intersection of <span className="italic">brand storytelling</span> and digital innovation.
              </h2>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 font-sans">
            <div className="space-y-2">
              <div className="flex items-center gap-2 opacity-40">
                <GraduationCap className="w-4 h-4" />
                <span className="text-[10px] uppercase tracking-wider font-bold">Education</span>
              </div>
              <p className="text-sm font-medium">ESMOD ISEM, Paris</p>
              <p className="text-xs opacity-60 italic">Fashion Business</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 opacity-40">
                <Briefcase className="w-4 h-4" />
                <span className="text-[10px] uppercase tracking-wider font-bold">Experience</span>
              </div>
              <p className="text-sm font-medium">Leal Daccarett</p>
              <p className="text-xs opacity-60 italic">Organizational Intern</p>
            </div>
          </div>
        </div>

        {/* Right Column: Interaction */}
        <div className="flex flex-col items-center lg:items-start space-y-12">
          <div className="max-w-md space-y-6">
            <h3 className="text-3xl md:text-5xl font-light leading-tight">
              Speak with <span className="italic">Isabela's</span> AI Representative.
            </h3>
            <p className="text-lg text-[#1A1A1A]/70 leading-relaxed">
              Ask about her academic background at ESMOD, her professional experiences in Bogotá, or her vision for fashion communication.
            </p>
          </div>

          {/* Voice Interface Widget */}
          <div className="w-full max-w-md bg-white rounded-[32px] p-8 shadow-xl border border-[#1A1A1A]/5 relative overflow-hidden">
            {/* Animated Background Pulse */}
            <AnimatePresence>
              {isSpeaking && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 0.1, scale: 1.2 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                  className="absolute inset-0 bg-[#5A5A40] rounded-full blur-3xl"
                />
              )}
            </AnimatePresence>

            <div className="relative z-10 flex flex-col items-center space-y-8">
              {/* Status Indicator */}
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
                <span className="text-[10px] uppercase tracking-[0.2em] font-sans font-bold opacity-40">
                  {isConnected ? 'Agent Online' : 'Agent Offline'}
                </span>
              </div>

              {/* Main Button */}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={isConnected ? disconnect : connectToLiveAPI}
                className={`w-24 h-24 rounded-full flex items-center justify-center transition-colors duration-500 ${
                  isConnected 
                    ? 'bg-[#1A1A1A] text-white' 
                    : 'bg-[#5A5A40] text-white hover:bg-[#4A4A30]'
                }`}
              >
                {isConnected ? (
                  <Mic className="w-8 h-8" />
                ) : (
                  <Sparkles className="w-8 h-8" />
                )}
              </motion.button>

              <div className="text-center space-y-2">
                <p className="font-sans font-bold text-sm">
                  {isConnected ? (isSpeaking ? 'Isabela is speaking...' : 'Listening to you...') : 'Start Conversation'}
                </p>
                <p className="text-xs opacity-40 italic">
                  {isConnected ? 'Tap to end session' : 'Professional Voice Agent'}
                </p>
              </div>

              {/* Audio Visualizer (Mock) */}
              {isConnected && (
                <div className="flex items-center gap-1 h-8">
                  {[...Array(12)].map((_, i) => (
                    <motion.div
                      key={i}
                      animate={{
                        height: isSpeaking || isRecording ? [8, Math.random() * 24 + 8, 8] : 8
                      }}
                      transition={{
                        repeat: Infinity,
                        duration: 0.5 + Math.random() * 0.5,
                        ease: "easeInOut"
                      }}
                      className="w-1 bg-[#1A1A1A]/20 rounded-full"
                    />
                  ))}
                </div>
              )}

              {error && (
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-red-500 text-[10px] uppercase font-sans font-bold text-center"
                >
                  {error}
                </motion.p>
              )}
            </div>
          </div>

          {/* Footer Micro-details */}
          <div className="flex gap-8 border-t border-[#1A1A1A]/10 pt-8 w-full max-w-md">
            <div className="space-y-1">
              <p className="text-[9px] uppercase font-sans font-bold opacity-30">Languages</p>
              <p className="text-[10px] font-sans font-medium">EN / FR / ES / IT</p>
            </div>
            <div className="space-y-1">
              <p className="text-[9px] uppercase font-sans font-bold opacity-30">Specialization</p>
              <p className="text-[10px] font-sans font-medium">Digital Strategy</p>
            </div>
            <div className="space-y-1">
              <p className="text-[9px] uppercase font-sans font-bold opacity-30">Availability</p>
              <p className="text-[10px] font-sans font-medium">Summer 2026</p>
            </div>
          </div>
        </div>
      </main>

      {/* Floating Decorative Element */}
      <div className="fixed bottom-12 right-12 hidden xl:block">
        <div className="writing-mode-vertical rotate-180 text-[10px] uppercase tracking-[0.5em] font-sans font-bold opacity-20">
          Fashion • Communication • Strategy
        </div>
      </div>
    </div>
  );
}
