/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { 
  Player, 
  ChatMessage, 
  SchoolSchedule, 
  SchoolPeriod, 
  ZoneId, 
  GameEvent, 
  CliqueType,
  Reputation 
} from './src/types.js';

dotenv.config();

// Initialize Gemini API if key is available
let ai: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  try {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    console.log('Gemini API initialized successfully on server.');
  } catch (err) {
    console.error('Failed to initialize Gemini API:', err);
  }
} else {
  console.log('Gemini API key not found. AI interactions will run in template/offline mode.');
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const PORT = 3000;

// Game State
let players: Map<string, Player> = new Map();
let chatHistory: ChatMessage[] = [];
const MAX_CHAT_HISTORY = 40;

// Seeding NPCs (Pupils and Director) to populate the school dynamically
const NPCS_LIST: Player[] = [
  {
    id: 'npc_diretor',
    name: '👑 Diretor Principal',
    hairType: 'short',
    hairColor: '#94a3b8',
    shirtColor: '#334155',
    pantsColor: '#0f172a',
    clique: 'Normal',
    reputation: { autoridade: 100, nerds: 80, populares: 80, atletas: 80, rebeldes: 10 },
    currentZone: 'DIRETORIA',
    x: 50,
    y: 35,
    grades: 100,
    isDetained: false,
    detentionTimeRemaining: 0,
    isAttendingClass: false,
    isSitting: true,
    isNpc: true
  },
  {
    id: 'npc_julio',
    name: '🤓 Julio (Nerd)',
    hairType: 'short',
    hairColor: '#d1a153',
    shirtColor: '#059669',
    pantsColor: '#1e293b',
    clique: 'Nerd',
    reputation: { autoridade: 80, nerds: 100, populares: 20, atletas: 30, rebeldes: 10 },
    currentZone: 'SALA_DE_AULA',
    x: 40,
    y: 50,
    grades: 95,
    isDetained: false,
    detentionTimeRemaining: 0,
    isAttendingClass: true,
    isSitting: true,
    isNpc: true
  },
  {
    id: 'npc_camila',
    name: '💅 Camila (Popular)',
    hairType: 'long',
    hairColor: '#ec4899',
    shirtColor: '#db2777',
    pantsColor: '#374151',
    clique: 'Popular',
    reputation: { autoridade: 40, nerds: 30, populares: 100, atletas: 80, rebeldes: 50 },
    currentZone: 'REFEITORIO',
    x: 40,
    y: 50,
    grades: 60,
    isDetained: false,
    detentionTimeRemaining: 0,
    isAttendingClass: false,
    isSitting: false,
    isNpc: true
  },
  {
    id: 'npc_leo',
    name: '🔥 Leo (Rebelde)',
    hairType: 'spiky',
    hairColor: '#090d16',
    shirtColor: '#dc2626',
    pantsColor: '#090d16',
    clique: 'Rebelde',
    reputation: { autoridade: 10, nerds: 10, populares: 60, atletas: 40, rebeldes: 100 },
    currentZone: 'PATIO',
    x: 25,
    y: 75,
    grades: 40,
    isDetained: false,
    detentionTimeRemaining: 0,
    isAttendingClass: false,
    isSitting: false,
    isNpc: true
  },
  {
    id: 'npc_diego',
    name: '👑 Diego (Atleta)',
    hairType: 'cap',
    hairColor: '#b45309',
    shirtColor: '#ea580c',
    pantsColor: '#1e293b',
    clique: 'Atleta',
    reputation: { autoridade: 55, nerds: 30, populares: 80, atletas: 100, rebeldes: 40 },
    currentZone: 'PATIO',
    x: 65,
    y: 35,
    grades: 65,
    isDetained: false,
    detentionTimeRemaining: 0,
    isAttendingClass: false,
    isSitting: false,
    isNpc: true
  }
];

// Seed NPCs on server initialization
NPCS_LIST.forEach(npc => {
  players.set(npc.id, npc);
});

// NPC Behavior AI Simulation Interval (Ticks every 4.5 seconds)
setInterval(() => {
  NPCS_LIST.forEach(npc => {
    // 1) Handle Room Migration based on School Period
    const period = schedule.currentPeriod;
    let targetZone = npc.currentZone;

    if (npc.id === 'npc_diretor') {
      // Diretor patrols classrooms, corridor, patio or stays in office
      if (Math.random() < 0.2) {
        const zones: ZoneId[] = ['DIRETORIA', 'CORREDOR', 'PATIO', 'REFEITORIO'];
        targetZone = zones[Math.floor(Math.random() * zones.length)];
      }
    } else if (npc.id === 'npc_julio') {
      // Julio (Nerd) stays in class during lectures, library or cafeteria during lunch
      if (period === 'AULA_1' || period === 'AULA_2') {
        targetZone = 'SALA_DE_AULA';
        npc.isAttendingClass = true;
        npc.isSitting = true;
      } else if (period === 'ALMOCO') {
        targetZone = 'REFEITORIO';
        npc.isSitting = true;
      } else {
        targetZone = Math.random() < 0.5 ? 'CORREDOR' : 'SALA_DE_AULA';
        npc.isSitting = Math.random() < 0.6;
      }
    } else if (npc.id === 'npc_camila') {
      // Camila (Popular) goes to Cafeteria, Corridor, or Classroom
      if (period === 'AULA_1' || period === 'AULA_2') {
        targetZone = Math.random() < 0.7 ? 'SALA_DE_AULA' : 'REFEITORIO';
        npc.isAttendingClass = targetZone === 'SALA_DE_AULA';
        npc.isSitting = targetZone === 'SALA_DE_AULA';
      } else if (period === 'ALMOCO') {
        targetZone = 'REFEITORIO';
        npc.isSitting = true;
      } else {
        targetZone = Math.random() < 0.5 ? 'CORREDOR' : 'PATIO';
        npc.isSitting = false;
      }
    } else if (npc.id === 'npc_leo') {
      // Leo (Rebelde) skips classes, loves Pátio or Corredor
      if (period === 'AULA_1' || period === 'AULA_2') {
        targetZone = Math.random() < 0.25 ? 'SALA_DE_AULA' : (Math.random() < 0.55 ? 'PATIO' : 'CORREDOR');
        npc.isAttendingClass = targetZone === 'SALA_DE_AULA';
        npc.isSitting = false;
      } else if (period === 'ALMOCO') {
        targetZone = 'REFEITORIO';
        npc.isSitting = false;
      } else {
        targetZone = Math.random() < 0.6 ? 'PATIO' : 'CORREDOR';
        npc.isSitting = false;
      }
    } else if (npc.id === 'npc_diego') {
      // Diego (Atleta) loves Pátio / Quadra, attends sports or classroom
      if (period === 'AULA_1' || period === 'AULA_2') {
        targetZone = Math.random() < 0.6 ? 'SALA_DE_AULA' : 'PATIO';
        npc.isAttendingClass = targetZone === 'SALA_DE_AULA';
        npc.isSitting = targetZone === 'SALA_DE_AULA';
      } else if (period === 'ALMOCO') {
        targetZone = 'REFEITORIO';
        npc.isSitting = true;
      } else {
        targetZone = 'PATIO';
        npc.isSitting = false;
      }
    }

    // Process room change or coordinate walk
    if (npc.currentZone !== targetZone) {
      npc.currentZone = targetZone;
      // Spawn nicely in the new room
      npc.x = 25 + Math.random() * 50;
      npc.y = 25 + Math.random() * 50;
    } else {
      // Micro-walking within current room
      if (!npc.isSitting) {
        const step = 12;
        npc.x = Math.max(8, Math.min(92, npc.x + (Math.random() * 2 - 1) * step));
        npc.y = Math.max(8, Math.min(92, npc.y + (Math.random() * 2 - 1) * step));
      }
    }

    // Broadcast NPC updated coordinates
    broadcast({
      type: 'player_moved',
      id: npc.id,
      x: npc.x,
      y: npc.y,
      currentZone: npc.currentZone,
      isSitting: npc.isSitting
    });

    // 2) Ambient School Chat chatter (5% chance per NPC per tick)
    if (Math.random() < 0.06) {
      let quote = '';
      if (npc.id === 'npc_diretor') {
        const quotes = [
          "Mantenham a ordem e a disciplina nos corredores!",
          "Sem correr ou tumulto perto dos armários, por favor.",
          "O futuro acadêmico de vocês depende de dedicação constante.",
          "Estudar é o caminho para o sucesso. Quem estiver fora de sala receberá detenção!"
        ];
        quote = quotes[Math.floor(Math.random() * quotes.length)];
      } else if (npc.id === 'npc_julio') {
        const quotes = [
          "Esse novo livro de equações lineares é incrível.",
          "Espero que a próxima aula tenha perguntas bônus!",
          "A biblioteca daqui é super silenciosa e produtiva.",
          "Alguém quer se juntar ao grupo de estudos para a prova de ciências?"
        ];
        quote = quotes[Math.floor(Math.random() * quotes.length)];
      } else if (npc.id === 'npc_camila') {
        const quotes = [
          "Gente, vocês viram quem estava conversando atrás da diretoria?",
          "Amei a cor do seu cabelo, super combinou!",
          "Vamos comer juntos no refeitório hoje para atualizar as fofocas?",
          "O sinal já vai tocar? Preciso me preparar para a aula da fofoca."
        ];
        quote = quotes[Math.floor(Math.random() * quotes.length)];
      } else if (npc.id === 'npc_leo') {
        const quotes = [
          "Essa aula tá insuportável... vou dar no pé.",
          "Muros cinzas são tão sem graça. Um grafite cairia bem ali.",
          "O inspetor está de olho, mas ele não me pega!",
          "Regras do colégio foram criadas só para a gente quebrar."
        ];
        quote = quotes[Math.floor(Math.random() * quotes.length)];
      } else if (npc.id === 'npc_diego') {
        const quotes = [
          "Quem topa uma partida rápida de futebol lá na quadra?",
          "O treino físico de hoje foi sensacional!",
          "Fazer cinquenta flexões no corredor antes da aula ajuda a focar.",
          "Esporte é vida! Mais um título para os atletas da escola."
        ];
        quote = quotes[Math.floor(Math.random() * quotes.length)];
      }

      if (quote) {
        const newMessage: ChatMessage = {
          id: `msg_npc_${Math.random().toString(36).substr(2, 9)}`,
          senderId: npc.id,
          senderName: npc.name,
          senderColor: npc.shirtColor,
          text: quote,
          timestamp: Date.now(),
          zone: npc.currentZone
        };

        chatHistory.push(newMessage);
        if (chatHistory.length > MAX_CHAT_HISTORY) {
          chatHistory.shift();
        }

        broadcast({
          type: 'chat_message',
          message: newMessage
        });
      }
    }
  });
}, 5000);

// School Schedule
const PERIODS: { period: SchoolPeriod; name: string; duration: number }[] = [
  { period: 'AULA_1', name: '1ª Aula: Matemática & Ciências', duration: 90 },
  { period: 'RECREIO', name: 'Recreio: Intervalo Livre', duration: 60 },
  { period: 'AULA_2', name: '2ª Aula: História & Geografia', duration: 90 },
  { period: 'ALMOCO', name: 'Almoço: Refeitório', duration: 60 },
  { period: 'FIM_DAS_AULAS', name: 'Fim das Aulas: Atividades Extra', duration: 60 }
];

let currentPeriodIndex = 0;
let schedule: SchoolSchedule = {
  currentPeriod: PERIODS[0].period,
  timeRemaining: PERIODS[0].duration,
  periodName: PERIODS[0].name
};

// Active Server-side Events
let activeEvents: Map<string, GameEvent> = new Map();

// Recent dynamic event definitions to select from
const DYNAMIC_EVENTS_POOL: GameEvent[] = [
  {
    id: 'DIRETOR_PATROL_1',
    title: 'Patrulha do Diretor!',
    description: 'O Diretor está rondando os armários com cara de poucos amigos. Quem estiver matando aula no corredor vai se dar mal!',
    zone: 'CORREDOR',
    options: [
      { id: 'correr', text: 'Correr para o banheiro', effects: { rebeldes: 15, autoridade: -10 } },
      { id: 'armario', text: 'Fingir que está organizando o armário', effects: { autoridade: 10, nerds: 5, rebeldes: -5 } },
      { id: 'subornar', text: 'Oferecer um chiclete de presente', effects: { rebeldes: 10, populares: 10, detain: true } }
    ]
  },
  {
    id: 'BRIGA_PATIO',
    title: 'Briga no Pátio!',
    description: 'Uma rodinha se formou! Dois alunos estão discutindo fervorosamente sobre quem é o melhor no futebol.',
    zone: 'PATIO',
    options: [
      { id: 'incentivar', text: 'Gritar "Briga! Briga! Briga!"', effects: { rebeldes: 20, populares: 10, autoridade: -15 } },
      { id: 'apartar', text: 'Entrar no meio para acalmar os ânimos', effects: { autoridade: 15, nerds: 10, populares: -5 } },
      { id: 'apostar', text: 'Apostar lanche no vencedor', effects: { atletas: 15, rebeldes: 10, autoridade: -10 } }
    ]
  },
  {
    id: 'DESAFIO_MATH',
    title: 'Pergunta Surpresa!',
    description: 'O professor lança um desafio no quadro valendo ponto na média!',
    zone: 'SALA_DE_AULA',
    options: [
      { id: 'responder_certo', text: 'Responder "B: 56" (7 x 8)', effects: { nerds: 20, autoridade: 15, grades: 10 } },
      { id: 'responder_errado', text: 'Chutar "A: 54" confiante', effects: { populares: 5, nerds: -5, grades: -5 } },
      { id: 'ignorar', text: 'Continuar desenhando na carteira', effects: { rebeldes: 10, autoridade: -5 } }
    ]
  },
  {
    id: 'FOFOCA_ALMOCO',
    title: 'A Grande Fofoca',
    description: 'Estão dizendo que o inspetor confiscou um videogame na sala de aula. A fofoca está correndo no refeitório!',
    zone: 'REFEITORIO',
    options: [
      { id: 'espalhar', text: 'Aumentar a fofoca com detalhes mentirosos', effects: { populares: 15, rebeldes: 5, autoridade: -10 } },
      { id: 'abafar', text: 'Dizer que fofoca é perda de tempo', effects: { nerds: 15, autoridade: 10 } },
      { id: 'investigar', text: 'Propor invadir a sala dos professores para recuperar', effects: { rebeldes: 25, populares: 10, autoridade: -20 } }
    ]
  },
  {
    id: 'GUERRA_DE_COMIDA',
    title: 'Guerra de Comida!',
    description: 'Alguém jogou purê de batata no líder dos rebeldes! O refeitório virou um caos total com comida voando para todos os lados!',
    zone: 'REFEITORIO',
    options: [
      { id: 'entrar_guerra', text: 'Pegar uma bandeja e arremessar purê!', effects: { rebeldes: 15, populares: 10, autoridade: -15 } },
      { id: 'proteger', text: 'Se esconder debaixo da mesa de madeira', effects: { nerds: 10, populares: -5 } },
      { id: 'dedurar', text: 'Chamar a inspetora imediatamente', effects: { autoridade: 20, rebeldes: -15, nerds: 5 } }
    ]
  },
  {
    id: 'DESAFIO_EMBAIXADINHA',
    title: 'Desafio de Embaixadinhas!',
    description: 'Diego e os atletas estão fazendo um desafio para ver quem consegue fazer mais embaixadinhas no pátio sem cair!',
    zone: 'PATIO',
    options: [
      { id: 'jogar', text: 'Aceitar o desafio e dar um show', effects: { atletas: 25, populares: 15, rebeldes: 5 } },
      { id: 'zoar', text: 'Ficar vaiando do lado e tentar derrubar a bola', effects: { rebeldes: 15, atletas: -10 } },
      { id: 'apoiar', text: 'Gritar e torcer fervorosamente como fã', effects: { atletas: 12, nerds: -5 } }
    ]
  },
  {
    id: 'EXAME_SURPRESA',
    title: 'Exame de Química Surpresa!',
    description: 'A professora entrou séria e mandou guardar todos os materiais. É um teste surpresa valendo 3 pontos!',
    zone: 'SALA_DE_AULA',
    options: [
      { id: 'colar', text: 'Tentar espiar a cola do nerd sentado ao lado', effects: { rebeldes: 15, grades: 10, autoridade: -12 } },
      { id: 'estudar', text: 'Resolver a prova usando seus conhecimentos', effects: { nerds: 25, grades: 15, rebeldes: -5 } },
      { id: 'dormir', text: 'Entregar em branco e dormir na mesa', effects: { rebeldes: 20, grades: -15, populares: 5 } }
    ]
  },
  {
    id: 'CONTRABANDO_DOCES',
    title: 'Contrabando de Pirulitos!',
    description: 'Bruna está vendendo doces e pirulitos ultra-ácidos proibidos escondida atrás dos armários!',
    zone: 'CORREDOR',
    options: [
      { id: 'comprar', text: 'Comprar um pirulito azul gigante de cereja', effects: { rebeldes: 10, populares: 10 } },
      { id: 'denunciar', text: 'Entregar o esquema para o diretor', effects: { autoridade: 18, rebeldes: -15 } },
      { id: 'ajudar', text: 'Ajudar a vigiar o corredor contra fiscais', effects: { rebeldes: 15, populares: 10 } }
    ]
  },
  {
    id: 'RODA_DE_RIMA',
    title: 'Roda de Rima!',
    description: 'Os rebeldes e populares formaram um círculo gigante no pátio para uma batalha de rap e rimas improvisadas!',
    zone: 'PATIO',
    options: [
      { id: 'rimar', text: 'Assumir o microfone e mandar rimas agressivas e geniais', effects: { populares: 25, rebeldes: 15, nerds: -5 } },
      { id: 'bater_palma', text: 'Bater palma no compasso e agitar a galera', effects: { populares: 12, atletas: 5 } },
      { id: 'zoar_rima', text: 'Dizer que as rimas são terríveis e rir alto', effects: { rebeldes: 15, populares: -5 } }
    ]
  },
  {
    id: 'QUIZ_NERD',
    title: 'Desafio Geek da Sala de Aula!',
    description: 'Os nerds montaram um Quiz de Cultura Pop e Ciências na lousa valendo uma edição de colecionador rara.',
    zone: 'SALA_DE_AULA',
    options: [
      { id: 'participar', text: 'Responder perguntas complexas sobre física e ficção científica', effects: { nerds: 25, grades: 10 } },
      { id: 'zuar', text: 'Apagar a lousa e chamar todo mundo de bobão', effects: { rebeldes: 18, populares: 8, nerds: -15 } },
      { id: 'assistir', text: 'Assistir em silêncio e aprender algo útil', effects: { nerds: 12 } }
    ]
  },
  {
    id: 'INVASAO_DIRETORIA',
    title: 'O Arquivo Secreto!',
    description: 'O Diretor saiu da sala por alguns minutos e deixou o computador ligado. Que tal dar uma espiada?',
    zone: 'DIRETORIA',
    options: [
      { id: 'vazar_gabarito', text: 'Procurar e vazar o gabarito das provas para a escola inteira', effects: { rebeldes: 25, populares: 15, autoridade: -20 } },
      { id: 'remover_detencao', text: 'Deletar seu próprio histórico de faltas e infrações', effects: { grades: 5, rebeldes: 10, autoridade: -10 } },
      { id: 'limpar_sala', text: 'Organizar a sala para que ele pense que você é prestativo', effects: { autoridade: 20, rebeldes: -10 } }
    ]
  }
];

// Helper to broadcast to all connected WebSocket clients
function broadcast(message: any) {
  const payload = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Tick game schedule
setInterval(() => {
  schedule.timeRemaining--;

  // Auto-manage player detentions
  players.forEach((player) => {
    if (player.isDetained) {
      player.detentionTimeRemaining--;
      if (player.detentionTimeRemaining <= 0) {
        player.isDetained = false;
        player.currentZone = 'CORREDOR';
        player.x = 50;
        player.y = 80;
        
        // Notify player release
        broadcast({
          type: 'player_updated',
          player: player
        });
        
        broadcast({
          type: 'announcement',
          text: `🔔 ${player.name} cumpriu sua detenção e foi liberado!`,
          category: 'info'
        });
      }
    }
  });

  // Check if principal catches anyone skiving class
  const isClassActive = schedule.currentPeriod === 'AULA_1' || schedule.currentPeriod === 'AULA_2';
  // Reduced catching probability from 0.015 to 0.003 to make detention a fun mechanic rather than a constant frustration
  if (isClassActive && Math.random() < 0.003) {
    // Principal patrols Corredor or Patio
    const potentialTargets: Player[] = [];
    players.forEach((p) => {
      if (!p.isDetained && !p.isAttendingClass && (p.currentZone === 'CORREDOR' || p.currentZone === 'PATIO')) {
        potentialTargets.push(p);
      }
    });

    if (potentialTargets.length > 0) {
      const target = potentialTargets[Math.floor(Math.random() * potentialTargets.length)];
      const caughtZone = target.currentZone;
      
      // Detain the target!
      target.isDetained = true;
      target.detentionTimeRemaining = 25; // 25 seconds of detention
      target.currentZone = 'DIRETORIA';
      target.x = 50;
      target.y = 50;
      target.reputation.autoridade = Math.max(0, target.reputation.autoridade - 15);
      target.reputation.rebeldes = Math.min(100, target.reputation.rebeldes + 10);
      
      broadcast({
        type: 'player_updated',
        player: target
      });

      broadcast({
        type: 'announcement',
        text: `🚨 O Diretor pegou ${target.name} matando aula no ${caughtZone === 'CORREDOR' ? 'corredor' : 'pátio'}! Direto para a diretoria!`,
        category: 'warning'
      });
    }
  }

  // Trigger occasional random dynamic event
  if (Math.random() < 0.08 && activeEvents.size === 0) {
    const randomEventDef = DYNAMIC_EVENTS_POOL[Math.floor(Math.random() * DYNAMIC_EVENTS_POOL.length)];
    // Make sure we generate a unique instance ID
    const eventInstance: GameEvent = {
      ...randomEventDef,
      id: `${randomEventDef.id}_${Date.now()}`
    };
    activeEvents.set(eventInstance.id, eventInstance);
    
    broadcast({
      type: 'event_triggered',
      event: eventInstance
    });

    broadcast({
      type: 'announcement',
      text: `📢 Evento Escolar: "${eventInstance.title}" ocorrendo na zona: ${eventInstance.zone || 'Todos'}!`,
      category: 'info'
    });
  }

  // Handle period transition
  if (schedule.timeRemaining <= 0) {
    currentPeriodIndex = (currentPeriodIndex + 1) % PERIODS.length;
    const nextPeriodDef = PERIODS[currentPeriodIndex];
    schedule = {
      currentPeriod: nextPeriodDef.period,
      timeRemaining: nextPeriodDef.duration,
      periodName: nextPeriodDef.name
    };

    // Auto-reset class attendance states
    const isNewPeriodClass = schedule.currentPeriod === 'AULA_1' || schedule.currentPeriod === 'AULA_2';
    players.forEach((player) => {
      player.isAttendingClass = false;
      if (!isNewPeriodClass && player.currentZone === 'SALA_DE_AULA') {
        // Move players out of classroom during recess/lunch
        player.currentZone = schedule.currentPeriod === 'ALMOCO' ? 'REFEITORIO' : 'PATIO';
        player.x = 20 + Math.random() * 60;
        player.y = 20 + Math.random() * 60;
        
        broadcast({
          type: 'player_updated',
          player: player
        });
      }
    });

    // Clear active events on period change
    activeEvents.clear();

    broadcast({
      type: 'schedule_update',
      schedule: schedule
    });

    broadcast({
      type: 'announcement',
      text: `🔔 Sinal tocando! Período atual: ${schedule.periodName}`,
      category: 'info'
    });
  } else {
    // Periodically broadcast timer updates to keep clients in sync
    if (schedule.timeRemaining % 10 === 0) {
      broadcast({
        type: 'schedule_update',
        schedule: schedule
      });
    }
  }
}, 1000);

// API Endpoints
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', onlinePlayers: players.size });
});

// Interactive AI Director excuse plea system
app.get('/api/director/excuse', async (req, res) => {
  const { playerId, excuse } = req.query;
  
  if (!playerId || !excuse) {
    return res.status(400).json({ error: 'Player ID and excuse are required' });
  }

  const player = players.get(playerId as string);
  if (!player) {
    return res.status(404).json({ error: 'Player not found' });
  }

  if (!player.isDetained) {
    return res.json({ response: 'Você não está detido! Volte para as aulas imediatamente.', released: false });
  }

  let aiResponseText = '';
  let released = false;
  let authorityChange = 0;

  if (ai) {
    try {
      const prompt = `Você é o Diretor da Escola "Escola Livre". Um aluno chamado ${player.name} (da facção/clique ${player.clique}) foi pego matando aula e está na detenção.
Ele veio até a sua mesa para te dar uma desculpa e tentar ser liberado mais cedo.
A desculpa do aluno é: "${excuse}".

Responda em português como o Diretor (seja firme, um pouco severo, mas justo). No final da sua resposta, inclua uma linha com formato JSON exatamente assim:
DECISION: {"released": true_or_false, "authority_change": integer_between_minus_10_and_15, "reason": "breve justificativa"}

Se a desculpa for criativa, educada, engraçada ou convincente, libere-o (released: true). Se for uma desculpa esfarrapada, insolente ou preguiçosa, mantenha-o detido (released: false) e talvez diminua a autoridade.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
      });

      const text = response.text || '';
      
      // Parse decision block
      const decisionMatch = text.match(/DECISION:\s*(\{.*\})/);
      aiResponseText = text.replace(/DECISION:\s*(\{.*\})/, '').trim();
      
      if (decisionMatch) {
        try {
          const decision = JSON.parse(decisionMatch[1]);
          released = !!decision.released;
          authorityChange = Number(decision.authority_change) || 0;
        } catch (_) {
          // Fallback if parsing fails
          released = excuse.toString().length > 25;
          authorityChange = released ? 5 : -5;
        }
      } else {
        released = excuse.toString().length > 25;
        authorityChange = released ? 5 : -5;
      }
    } catch (err) {
      console.error('Error in Gemini call:', err);
      aiResponseText = 'Hum... Essa desculpa não me pareceu muito convincente. Mas vou pensar no seu caso. Comporte-se!';
      released = excuse.toString().length > 30;
      authorityChange = released ? 5 : -2;
    }
  } else {
    // Fallback if no Gemini key
    const excuseLength = excuse.toString().length;
    if (excuseLength < 10) {
      aiResponseText = 'Isso é tudo o que você tem a dizer? "Não fiz nada"? Fique na detenção e pense no que fez!';
      released = false;
      authorityChange = -3;
    } else if (excuseLength > 40) {
      aiResponseText = 'Uma desculpa bem elaborada... Admiro a criatividade. Está liberado por hoje, mas não me deixe te pegar matando aula de novo!';
      released = true;
      authorityChange = 8;
    } else {
      aiResponseText = 'Sei... Estou de olho em você. Vou reduzir um pouco seu tempo, mas preste mais atenção!';
      released = false;
      player.detentionTimeRemaining = Math.max(2, player.detentionTimeRemaining - 10);
      authorityChange = 3;
    }
  }

  // Apply changes to the player
  if (released) {
    player.isDetained = false;
    player.detentionTimeRemaining = 0;
    player.currentZone = 'CORREDOR';
    player.x = 50;
    player.y = 80;
  }
  
  player.reputation.autoridade = Math.min(100, Math.max(0, player.reputation.autoridade + authorityChange));
  
  broadcast({
    type: 'player_updated',
    player: player
  });

  if (released) {
    broadcast({
      type: 'announcement',
      text: `🔓 O Diretor aceitou a desculpa de ${player.name} e o liberou da detenção!`,
      category: 'success'
    });
  }

  res.json({
    response: aiResponseText,
    released,
    authorityChange
  });
});

// Upgrade HTTP Server to handle WebSockets
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// WebSocket Connection Handler
wss.on('connection', (ws) => {
  let boundPlayerId: string | null = null;

  ws.on('message', (messageBuffer) => {
    try {
      const data = JSON.parse(messageBuffer.toString());

      switch (data.type) {
        case 'join': {
          const { name, hairType, hairColor, shirtColor, pantsColor, clique } = data;
          const id = `player_${Math.random().toString(36).substr(2, 9)}`;
          boundPlayerId = id;

          // Initial reputation based on Clique
          const defaultRep: Reputation = {
            autoridade: 50,
            nerds: 30,
            populares: 30,
            atletas: 30,
            rebeldes: 30
          };

          if (clique === 'Nerd') {
            defaultRep.nerds = 70;
            defaultRep.autoridade = 60;
            defaultRep.rebeldes = 10;
          } else if (clique === 'Popular') {
            defaultRep.populares = 70;
            defaultRep.rebeldes = 40;
            defaultRep.autoridade = 40;
          } else if (clique === 'Atleta') {
            defaultRep.atletas = 70;
            defaultRep.populares = 50;
          } else if (clique === 'Rebelde') {
            defaultRep.rebeldes = 70;
            defaultRep.autoridade = 20;
            defaultRep.nerds = 10;
          }

          const isClassPeriod = schedule.currentPeriod === 'AULA_1' || schedule.currentPeriod === 'AULA_2';
          const defaultSpawnZone = isClassPeriod 
            ? 'SALA_DE_AULA' 
            : (schedule.currentPeriod === 'ALMOCO' ? 'REFEITORIO' : 'PATIO');

          const newPlayer: Player = {
            id,
            name: name || `Aluno ${Math.floor(100 + Math.random() * 900)}`,
            hairType: hairType || 'hair_1',
            hairColor: hairColor || '#4a3728',
            shirtColor: shirtColor || '#2563eb',
            pantsColor: pantsColor || '#1e293b',
            clique: clique || 'Normal',
            reputation: defaultRep,
            currentZone: defaultSpawnZone,
            x: 20 + Math.random() * 60,
            y: 40 + Math.random() * 40,
            grades: 70,
            isDetained: false,
            detentionTimeRemaining: 0,
            isAttendingClass: false,
            isSitting: false
          };

          players.set(id, newPlayer);

          // Send current state to joining player
          ws.send(JSON.stringify({
            type: 'sync',
            players: Array.from(players.values()),
            schedule,
            chatHistory,
            activeEvents: Array.from(activeEvents.values()),
            myPlayerId: id
          }));

          // Broadcast join to all other players
          broadcast({
            type: 'player_joined',
            player: newPlayer
          });

          broadcast({
            type: 'announcement',
            text: `👋 ${newPlayer.name} entrou no colégio como ${newPlayer.clique}!`,
            category: 'info'
          });
          break;
        }

        case 'move': {
          if (!boundPlayerId) return;
          const player = players.get(boundPlayerId);
          if (player) {
            // Cannot move if detained in director room unless they are already in the director's room
            if (player.isDetained && data.zone !== 'DIRETORIA') {
              // Forced sync back
              ws.send(JSON.stringify({
                type: 'player_updated',
                player
              }));
              return;
            }

            player.x = Math.max(0, Math.min(100, data.x));
            player.y = Math.max(0, Math.min(100, data.y));
            player.isSitting = !!data.isSitting;
            
            // If they changed zone
            if (player.currentZone !== data.zone) {
              player.currentZone = data.zone as ZoneId;
              player.isAttendingClass = false; // reset attending when leaving zone
              player.isSitting = false; // reset sitting when leaving zone
            }

            broadcast({
              type: 'player_moved',
              id: player.id,
              x: player.x,
              y: player.y,
              currentZone: player.currentZone,
              isSitting: player.isSitting
            });
          }
          break;
        }

        case 'chat': {
          if (!boundPlayerId) return;
          const player = players.get(boundPlayerId);
          if (player) {
            const cleanText = data.text.trim().substring(0, 100);
            if (!cleanText) return;

            const newMessage: ChatMessage = {
              id: `msg_${Math.random().toString(36).substr(2, 9)}`,
              senderId: player.id,
              senderName: player.name,
              senderColor: player.shirtColor,
              text: cleanText,
              timestamp: Date.now(),
              zone: player.currentZone
            };

            chatHistory.push(newMessage);
            if (chatHistory.length > MAX_CHAT_HISTORY) {
              chatHistory.shift();
            }

            broadcast({
              type: 'chat_message',
              message: newMessage
            });
          }
          break;
        }

        case 'attend_class': {
          if (!boundPlayerId) return;
          const player = players.get(boundPlayerId);
          if (player && !player.isDetained) {
            const isClassPeriod = schedule.currentPeriod === 'AULA_1' || schedule.currentPeriod === 'AULA_2';
            if (player.currentZone === 'SALA_DE_AULA' && isClassPeriod) {
              player.isAttendingClass = data.isAttending;
              
              if (player.isAttendingClass) {
                // Periodically attending gives small reputation/grades on action
                player.reputation.autoridade = Math.min(100, player.reputation.autoridade + 3);
                player.reputation.nerds = Math.min(100, player.reputation.nerds + 2);
                player.grades = Math.min(100, player.grades + 2);
              } else {
                player.reputation.rebeldes = Math.min(100, player.reputation.rebeldes + 5);
                player.reputation.autoridade = Math.max(0, player.reputation.autoridade - 4);
              }

              broadcast({
                type: 'player_updated',
                player
              });
            }
          }
          break;
        }

        case 'perform_action': {
          if (!boundPlayerId) return;
          const player = players.get(boundPlayerId);
          if (player) {
            const { actionType } = data;
            
            if (actionType === 'graffiti' && player.currentZone === 'PATIO') {
              player.reputation.rebeldes = Math.min(100, player.reputation.rebeldes + 15);
              player.reputation.autoridade = Math.max(0, player.reputation.autoridade - 10);
              player.reputation.populares = Math.min(100, player.reputation.populares + 5);
              
              broadcast({
                type: 'player_updated',
                player
              });

              broadcast({
                type: 'announcement',
                text: `🎨 ${player.name} fez um grafite irado no muro do pátio! (+Rebeldia, -Autoridade)`,
                category: 'info'
              });
            } else if (actionType === 'jogar_bola' && player.currentZone === 'PATIO') {
              player.reputation.atletas = Math.min(100, player.reputation.atletas + 15);
              player.reputation.populares = Math.min(100, player.reputation.populares + 8);
              
              broadcast({
                type: 'player_updated',
                player
              });

              broadcast({
                type: 'announcement',
                text: `⚽ ${player.name} marcou um golaço na quadra! (+Atleta)`,
                category: 'success'
              });
            } else if (actionType === 'bombinha' && player.currentZone === 'PATIO') {
              player.reputation.rebeldes = Math.min(100, player.reputation.rebeldes + 20);
              player.reputation.autoridade = Math.max(0, player.reputation.autoridade - 15);
              
              broadcast({
                type: 'player_updated',
                player
              });

              broadcast({
                type: 'announcement',
                text: `💣 BUM! ${player.name} estourou uma bombinha no pátio e assustou todo mundo! (+Rebeldia, --Autoridade)`,
                category: 'warning'
              });
            } else if (actionType === 'estudar' && player.currentZone === 'SALA_DE_AULA') {
              player.reputation.nerds = Math.min(100, player.reputation.nerds + 15);
              player.reputation.autoridade = Math.min(100, player.reputation.autoridade + 5);
              player.grades = Math.min(100, player.grades + 5);

              broadcast({
                type: 'player_updated',
                player
              });

              broadcast({
                type: 'announcement',
                text: `📚 ${player.name} está estudando muito para os exames! (+Nerd, +Média)`,
                category: 'success'
              });
            } else if (actionType === 'desenhar_quadro' && player.currentZone === 'SALA_DE_AULA') {
              player.reputation.rebeldes = Math.min(100, player.reputation.rebeldes + 12);
              player.reputation.autoridade = Math.max(0, player.reputation.autoridade - 6);
              
              broadcast({
                type: 'player_updated',
                player
              });

              broadcast({
                type: 'announcement',
                text: `🖍️ ${player.name} desenhou uma caricatura hilária do Diretor no quadro negro! (+Rebeldia)`,
                category: 'info'
              });
            } else if (actionType === 'bolinha_papel' && player.currentZone === 'SALA_DE_AULA') {
              player.reputation.rebeldes = Math.min(100, player.reputation.rebeldes + 10);
              player.reputation.nerds = Math.max(0, player.reputation.nerds - 5);
              player.reputation.autoridade = Math.max(0, player.reputation.autoridade - 5);
              
              broadcast({
                type: 'player_updated',
                player
              });

              broadcast({
                type: 'announcement',
                text: `🗑️ ${player.name} jogou uma bolinha de papel molhada bem na testa do professor! (+Rebeldia)`,
                category: 'warning'
              });
            } else if (actionType === 'lanchar' && player.currentZone === 'REFEITORIO') {
              player.reputation.populares = Math.min(100, player.reputation.populares + 5);
              player.reputation.atletas = Math.min(100, player.reputation.atletas + 5);
              
              broadcast({
                type: 'announcement',
                text: `🍔 ${player.name} está curtindo um lanche com a galera no refeitório!`,
                category: 'info'
              });
            } else if (actionType === 'guerra_comida_action' && player.currentZone === 'REFEITORIO') {
              player.reputation.rebeldes = Math.min(100, player.reputation.rebeldes + 18);
              player.reputation.autoridade = Math.max(0, player.reputation.autoridade - 10);
              player.reputation.populares = Math.min(100, player.reputation.populares + 8);
              
              broadcast({
                type: 'player_updated',
                player
              });

              broadcast({
                type: 'announcement',
                text: `🥧 GUERRA DE COMIDA! ${player.name} jogou uma torta de recheio duplo na mesa principal! (+Rebeldia, +Popularidade)`,
                category: 'warning'
              });
            } else if (actionType === 'casca_banana' && player.currentZone === 'REFEITORIO') {
              player.reputation.rebeldes = Math.min(100, player.reputation.rebeldes + 12);
              player.reputation.autoridade = Math.max(0, player.reputation.autoridade - 8);
              
              broadcast({
                type: 'player_updated',
                player
              });

              broadcast({
                type: 'announcement',
                text: `🧼 ${player.name} deixou uma casca de banana escorregadia no refeitório! Cuidado! (+Rebeldia)`,
                category: 'info'
              });
            } else if (actionType === 'extintor' && player.currentZone === 'CORREDOR') {
              player.reputation.rebeldes = Math.min(100, player.reputation.rebeldes + 15);
              player.reputation.autoridade = Math.max(0, player.reputation.autoridade - 12);
              
              broadcast({
                type: 'player_updated',
                player
              });

              broadcast({
                type: 'announcement',
                text: `💨 ${player.name} disparou o extintor de pó químico e empesteou o corredor! CHAMA O DIRETOR! (+Rebeldia)`,
                category: 'warning'
              });
            } else if (actionType === 'sabotar_bebedouro' && player.currentZone === 'CORREDOR') {
              player.reputation.rebeldes = Math.min(100, player.reputation.rebeldes + 12);
              player.reputation.atletas = Math.min(100, player.reputation.atletas + 6);
              player.reputation.autoridade = Math.max(0, player.reputation.autoridade - 8);
              
              broadcast({
                type: 'player_updated',
                player
              });

              broadcast({
                type: 'announcement',
                text: `💦 ${player.name} sabotou a válvula do bebedouro! Água voando para todo lado! (+Rebeldia)`,
                category: 'info'
              });
            } else if (actionType === 'trote_telefone' && player.currentZone === 'DIRETORIA') {
              player.reputation.rebeldes = Math.min(100, player.reputation.rebeldes + 25);
              player.reputation.autoridade = Math.max(0, player.reputation.autoridade - 18);
              player.reputation.populares = Math.min(100, player.reputation.populares + 10);
              
              broadcast({
                type: 'player_updated',
                player
              });

              broadcast({
                type: 'announcement',
                text: `☎️ ABSOLUTAMENTE LENDÁRIO! ${player.name} passou um trote do telefone da mesa do Diretor! (+Rebeldia, -Autoridade)`,
                category: 'warning'
              });
            }
          }
          break;
        }

        case 'event_choice': {
          if (!boundPlayerId) return;
          const player = players.get(boundPlayerId);
          const { eventId, optionId } = data;
          
          const gameEvent = activeEvents.get(eventId);
          if (player && gameEvent) {
            const option = gameEvent.options.find(o => o.id === optionId);
            if (option) {
              // Apply reputation adjustments
              if (option.effects.autoridade) player.reputation.autoridade = Math.min(100, Math.max(0, player.reputation.autoridade + option.effects.autoridade));
              if (option.effects.nerds) player.reputation.nerds = Math.min(100, Math.max(0, player.reputation.nerds + option.effects.nerds));
              if (option.effects.populares) player.reputation.populares = Math.min(100, Math.max(0, player.reputation.populares + option.effects.populares));
              if (option.effects.atletas) player.reputation.atletas = Math.min(100, Math.max(0, player.reputation.atletas + option.effects.atletas));
              if (option.effects.rebeldes) player.reputation.rebeldes = Math.min(100, Math.max(0, player.reputation.rebeldes + option.effects.rebeldes));
              if (option.effects.grades) player.grades = Math.min(100, Math.max(0, player.grades + option.effects.grades));
              
              if (option.effects.detain) {
                player.isDetained = true;
                player.detentionTimeRemaining = 20;
                player.currentZone = 'DIRETORIA';
                player.x = 50;
                player.y = 50;
              }

              broadcast({
                type: 'player_updated',
                player
              });

              // Remove the event from active events list on server
              activeEvents.delete(eventId);

              ws.send(JSON.stringify({
                type: 'choice_processed',
                success: true,
                optionText: option.text,
                effects: option.effects
              }));

              // Inform all clients that the event has ended
              broadcast({
                type: 'event_ended',
                eventId: gameEvent.id
              });

              broadcast({
                type: 'announcement',
                text: `🎭 ${player.name} tomou uma decisão no evento "${gameEvent.title}": "${option.text}"!`,
                category: 'info'
              });
            }
          }
          break;
        }
      }
    } catch (err) {
      console.error('Error processing WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    if (boundPlayerId) {
      const player = players.get(boundPlayerId);
      if (player) {
        broadcast({
          type: 'player_left',
          id: boundPlayerId
        });
        
        broadcast({
          type: 'announcement',
          text: `🚪 ${player.name} foi embora da escola.`,
          category: 'info'
        });

        players.delete(boundPlayerId);
      }
    }
  });
});

// Setup Vite & static serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
