import React, { useState, useRef, useEffect } from 'react';
import {
  MessageCircle,
  X,
  Send,
  Loader2,
  Bot,
  Sparkles,
  RotateCcw,
  AlertCircle,
  Store,
  ChevronDown,
  QrCode,
} from 'lucide-react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ChatWidgetProps {
  storeId: string;
  storeName?: string;
  storeType?: string;
  primaryColor?: string;
  hasFloatingCart?: boolean;
  className?: string;
  qrImageUrl?: string | null;
  storeWhatsapp?: string;
}

function isQrPaymentQuery(query: string): boolean {
  if (!query || typeof query !== 'string') return false;
  const q = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const hasQrKeyword = q.includes('qr') || q.includes('q.r');
  const hasPayKeyword =
    q.includes('paga') ||
    q.includes('pago') ||
    q.includes('cobro') ||
    q.includes('transfer') ||
    q.includes('cuenta');

  if (hasQrKeyword) return true;
  if (
    hasPayKeyword &&
    (q.includes('codigo') || q.includes('escan') || q.includes('foto') || q.includes('imagen'))
  ) {
    return true;
  }
  return false;
}

const RenderMessageContent: React.FC<{ content: string; isUser: boolean }> = ({
  content,
  isUser,
}) => {
  if (isUser) {
    return <span>{content}</span>;
  }

  // 1. Extraer imágenes Markdown: ![alt](url) soportando tanto https:// como data:image/
  const imageRegex = /!\[([^\]]*)\]\(((?:https?:\/\/|data:image\/)[^\s\)]+)\)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = imageRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(renderTextWithLinks(content.substring(lastIndex, match.index), `txt-${lastIndex}`));
    }
    const alt = match[1] || 'Código QR de Pago';
    const src = match[2];
    parts.push(
      <div
        key={`img-${match.index}`}
        className="my-2.5 p-3 bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700/80 shadow-xs max-w-full w-full sm:max-w-xs mx-auto text-center space-y-2 animate-in fade-in duration-200"
      >
        <div className="flex items-center justify-center gap-1.5 text-[11px] font-bold text-stone-800 dark:text-stone-200">
          <QrCode className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
          <span className="truncate">{alt}</span>
        </div>
        {/* Contenedor interior blanco para contraste óptico perfecto en escaneo bancario aun en modo oscuro */}
        <div className="p-2.5 bg-white rounded-xl border border-stone-200 dark:border-stone-700 shadow-2xs inline-block">
          <img
            src={src}
            alt={alt}
            className="w-44 h-44 sm:w-48 sm:h-48 max-w-full object-contain block mx-auto select-none"
            loading="eager"
          />
        </div>
        <div className="text-[10px] text-stone-500 dark:text-stone-400 font-medium">
          Escanea desde tu app bancaria móvil
        </div>
      </div>
    );
    lastIndex = imageRegex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push(renderTextWithLinks(content.substring(lastIndex), `txt-${lastIndex}`));
  }

  return <div className="space-y-1">{parts}</div>;
};

function renderTextWithLinks(text: string, keyPrefix: string): React.ReactNode {
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)|(https?:\/\/[^\s\)]+)/g;
  const elements: React.ReactNode[] = [];
  let lastIdx = 0;
  let linkMatch: RegExpExecArray | null;

  while ((linkMatch = linkRegex.exec(text)) !== null) {
    if (linkMatch.index > lastIdx) {
      elements.push(renderFormattedInline(text.substring(lastIdx, linkMatch.index), `${keyPrefix}-${lastIdx}`));
    }
    const label = linkMatch[1] || (linkMatch[3]?.includes('wa.me') ? '👉 Enviar pedido por WhatsApp' : linkMatch[3]);
    const url = linkMatch[2] || linkMatch[3];
    const isWhatsApp = url.includes('wa.me') || url.includes('whatsapp.com');

    elements.push(
      <a
        key={`link-${keyPrefix}-${linkMatch.index}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={
          isWhatsApp
            ? 'inline-flex items-center gap-1.5 px-3 py-1.5 my-1.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold rounded-xl text-[11px] shadow-sm transition-all hover:scale-[1.02] cursor-pointer no-underline'
            : 'text-emerald-600 dark:text-emerald-400 hover:underline font-semibold break-all'
        }
      >
        {isWhatsApp && <span>💬</span>}
        <span>{label}</span>
      </a>
    );
    lastIdx = linkRegex.lastIndex;
  }

  if (lastIdx < text.length) {
    elements.push(renderFormattedInline(text.substring(lastIdx), `${keyPrefix}-${lastIdx}`));
  }

  return <span key={`chunk-${keyPrefix}`}>{elements}</span>;
}

function renderFormattedInline(inlineText: string, key: string): React.ReactNode {
  const boldRegex = /\*\*([^*]+)\*\*/g;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let boldMatch: RegExpExecArray | null;

  while ((boldMatch = boldRegex.exec(inlineText)) !== null) {
    if (boldMatch.index > lastIdx) {
      parts.push(inlineText.substring(lastIdx, boldMatch.index));
    }
    parts.push(
      <strong key={`b-${key}-${boldMatch.index}`} className="font-semibold text-stone-900 dark:text-stone-100">
        {boldMatch[1]}
      </strong>
    );
    lastIdx = boldRegex.lastIndex;
  }

  if (lastIdx < inlineText.length) {
    parts.push(inlineText.substring(lastIdx));
  }

  return <span key={`inline-${key}`}>{parts}</span>;
}

export const ChatWidget: React.FC<ChatWidgetProps> = ({
  storeId,
  storeName = 'la tienda',
  storeType = 'general',
  primaryColor = '#2563eb',
  hasFloatingCart = false,
  className = '',
  qrImageUrl,
  storeWhatsapp,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Inicializar mensaje de bienvenida cuando se abre por primera vez
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          id: 'welcome-msg',
          role: 'assistant',
          content: `¡Hola! 👋 Soy el asistente virtual inteligente de **${storeName}**.\n\n¿En qué puedo ayudarte hoy? Puedes preguntarme sobre productos disponibles, precios, promociones, horarios de atención o métodos de envío.`,
          timestamp: new Date(),
        },
      ]);
    }
  }, [storeName, messages.length]);

  // Desplazar automáticamente hacia abajo al recibir nuevos mensajes
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen, messages, isLoading]);

  // Preguntas sugeridas basadas en el tipo de tienda
  const getSuggestions = () => {
    switch (storeType) {
      case 'restaurante':
        return [
          '¿Cuál es el menú disponible?',
          '¿Cómo puedo pagar por QR?',
          '¿Tienen envíos a domicilio?',
        ];
      case 'moda':
        return [
          '¿Qué prendas tienen en catálogo?',
          '¿Puedo pagar con QR?',
          '¿Qué promociones están activas?',
        ];
      case 'servicios':
        return [
          '¿Qué servicios ofrecen?',
          '¿Tienen código QR para pagar?',
          '¿Cuáles son los horarios de atención?',
        ];
      default:
        return [
          '¿Qué productos tienen en catálogo?',
          '¿Tienen código QR para pagar?',
          '¿Cuáles son los métodos de pago?',
        ];
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputValue).trim();
    if (!text || isLoading) return;

    setErrorMessage(null);
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputValue('');
    setIsLoading(true);

    try {
      // Preparar historial para enviar al endpoint
      const historyPayload = newMessages
        .filter((m) => m.id !== 'welcome-msg')
        .slice(-6)
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      const response = await fetch('/api/chat', {
        // Acota el tiempo de espera en el navegador, sin cambiar el contrato JSON del chat.
        signal: AbortSignal.timeout(40000),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          store_id: storeId,
          message: text,
          history: historyPayload,
          qrImageUrl: qrImageUrl || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        // Fallback resiliente para consulta sobre QR si el servicio backend o clave de IA presenta interrupciones
        if (isQrPaymentQuery(text)) {
          const fallbackReply = qrImageUrl
            ? `¡Claro! 💜 Este es el código QR de **${storeName}** para que puedas realizar tu pago:\n\n![Código QR de Pago - ${storeName}](${qrImageUrl})\n\nPuedes escanear este QR desde tu aplicación bancaria para realizar el pago.\n\nUna vez realizado el pago, recuerda enviar tu comprobante por WhatsApp junto con el pedido que tienes en tu carrito. Así el comercio podrá revisar la información de tu pago. 📲`
            : `Por el momento, este comercio no tiene un código QR de pago disponible.\n\nPuedes revisar los otros métodos de pago disponibles en el carrito o coordinar directamente con **${storeName}** por WhatsApp.`;

          const botMessage: ChatMessage = {
            id: `bot-${Date.now()}`,
            role: 'assistant',
            content: fallbackReply,
            timestamp: new Date(),
          };

          setMessages((prev) => [...prev, botMessage]);
          setIsLoading(false);
          return;
        }

        throw new Error(
          data.error || 'No fue posible obtener una respuesta en este momento.'
        );
      }

      const botMessage: ChatMessage = {
        id: `bot-${Date.now()}`,
        role: 'assistant',
        content: data.reply || 'Disculpa, no pude procesar la consulta.',
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, botMessage]);
    } catch (err: any) {
      console.error('[ChatWidget] Error enviando mensaje:', err);

      // Si el fallo fue al consultar por QR, asistir de inmediato con los datos del comercio
      if (isQrPaymentQuery(text)) {
        const fallbackReply = qrImageUrl
          ? `¡Claro! 💜 Este es el código QR de **${storeName}** para que puedas realizar tu pago:\n\n![Código QR de Pago - ${storeName}](${qrImageUrl})\n\nPuedes escanear este QR desde tu aplicación bancaria para realizar el pago.\n\nUna vez realizado el pago, recuerda enviar tu comprobante por WhatsApp junto con el pedido que tienes en tu carrito. Así el comercio podrá revisar la información de tu pago. 📲`
          : `Por el momento, este comercio no tiene un código QR de pago disponible.\n\nPuedes revisar los otros métodos de pago disponibles en el carrito o coordinar directamente con **${storeName}** por WhatsApp.`;

        setMessages((prev) => [
          ...prev,
          {
            id: `bot-${Date.now()}`,
            role: 'assistant',
            content: fallbackReply,
            timestamp: new Date(),
          },
        ]);
        return;
      }

      const friendlyError =
        err?.message?.includes('GEMINI_API_KEY')
          ? 'El servicio de IA requiere configurar la clave GEMINI_API_KEY en el servidor.'
          : err?.message || 'Hubo un error de conexión con el asistente.';

      setErrorMessage(friendlyError);

      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `⚠️ ${friendlyError}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleResetChat = () => {
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        role: 'assistant',
        content: `¡Conversación reiniciada! 👋 Soy el asistente virtual inteligente de **${storeName}**.\n\n¿En qué puedo ayudarte?`,
        timestamp: new Date(),
      },
    ]);
    setErrorMessage(null);
  };

  // Posicionamiento dinámico: si el carrito flotante está activo, elevamos el botón
  const bottomPositionClass = hasFloatingCart
    ? 'bottom-24 sm:bottom-24'
    : 'bottom-5 sm:bottom-5';

  return (
    <aside
      aria-label={`Chatbot de atención inteligente de ${storeName}`}
      className={`fixed ${bottomPositionClass} right-4 sm:right-6 z-40 transition-all duration-300 ${className}`}
    >
      {/* BOTÓN DISCRETO FLOTANTE (TRIGGER) */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          style={{ backgroundColor: primaryColor }}
          className="group relative flex items-center gap-2.5 px-4 py-3 rounded-full text-white shadow-xl hover:shadow-2xl hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer border border-white/25"
          title={`Abrir asistente virtual de ${storeName}`}
          aria-expanded={false}
          aria-haspopup="dialog"
        >
          <div className="relative flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-amber-200 animate-pulse" />
          </div>
          <span className="text-xs font-bold tracking-wide select-none pr-1 hidden xs:inline sm:inline">
            Atención IA
          </span>
          <span className="flex h-2.5 w-2.5 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span>
          </span>
        </button>
      )}

      {/* VENTANA FLOTANTE DEL CHAT */}
      {isOpen && (
        <div
          role="dialog"
          aria-labelledby="chat-widget-title"
          className="w-[calc(100vw-2rem)] xs:w-[360px] sm:w-[400px] h-[520px] max-h-[calc(100vh-6rem)] flex flex-col rounded-3xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-2xl overflow-hidden animate-in zoom-in-95 fade-in duration-200"
        >
          {/* HEADER DEL CHAT */}
          <header
            style={{ backgroundColor: primaryColor }}
            className="px-4 py-3.5 text-white flex items-center justify-between shadow-md shrink-0 select-none"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-2xl bg-white/15 backdrop-blur-sm border border-white/20 flex items-center justify-center shrink-0 shadow-sm">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h3
                    id="chat-widget-title"
                    className="text-xs font-extrabold truncate text-white tracking-wide"
                  >
                    {storeName}
                  </h3>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  <span className="text-[10px] text-white/85 font-medium">
                    Asistente Inteligente • En línea
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleResetChat}
                className="p-1.5 rounded-xl hover:bg-white/15 text-white/90 hover:text-white transition-colors cursor-pointer"
                title="Reiniciar conversación"
                aria-label="Reiniciar conversación"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-xl hover:bg-white/15 text-white/90 hover:text-white transition-colors cursor-pointer"
                title="Cerrar chat"
                aria-label="Cerrar chat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </header>

          {/* CUERPO DEL CHAT: HISTORIAL DE MENSAJES */}
          <div className="flex-1 p-3.5 overflow-y-auto space-y-3 bg-stone-50/80 dark:bg-stone-950/60">
            {messages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={msg.id}
                  className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-in fade-in duration-150`}
                >
                  {!isUser && (
                    <div
                      style={{ backgroundColor: `${primaryColor}20`, color: primaryColor }}
                      className="w-7 h-7 rounded-xl flex items-center justify-center mr-2 shrink-0 mt-0.5 border border-stone-200 dark:border-stone-800"
                    >
                      <Bot className="w-4 h-4" />
                    </div>
                  )}

                  <div
                    style={
                      isUser
                        ? { backgroundColor: primaryColor }
                        : undefined
                    }
                    className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed shadow-sm break-words whitespace-pre-wrap ${
                      isUser
                        ? 'text-white rounded-tr-xs font-normal'
                        : 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 rounded-tl-xs border border-stone-200/80 dark:border-stone-700/60'
                    }`}
                  >
                    <RenderMessageContent content={msg.content} isUser={isUser} />
                    <div
                      className={`text-[9px] mt-1 select-none text-right ${
                        isUser ? 'text-white/70' : 'text-stone-400 dark:text-stone-500'
                      }`}
                    >
                      {msg.timestamp.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* ESTADO DE CARGA / TYPING INDICATOR */}
            {isLoading && (
              <div className="flex justify-start items-center gap-2 animate-in fade-in duration-150">
                <div
                  style={{ backgroundColor: `${primaryColor}20`, color: primaryColor }}
                  className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0 border border-stone-200 dark:border-stone-800"
                >
                  <Bot className="w-4 h-4" />
                </div>
                <div className="bg-white dark:bg-stone-800 border border-stone-200/80 dark:border-stone-700/60 px-3.5 py-2.5 rounded-2xl rounded-tl-xs shadow-sm flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-stone-400 dark:bg-stone-500 animate-bounce"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-stone-400 dark:bg-stone-500 animate-bounce [animation-delay:0.2s]"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-stone-400 dark:bg-stone-500 animate-bounce [animation-delay:0.4s]"></span>
                  <span className="text-[11px] ml-1">Consultando catálogo...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* CHIPS DE SUGERENCIAS RÁPIDAS (SOLO SI HAY POCOS MENSAJES Y NO ESTÁ CARGANDO) */}
          {messages.length <= 2 && !isLoading && (
            <div className="px-3 py-2 bg-white dark:bg-stone-900 border-t border-stone-100 dark:border-stone-800 flex gap-1.5 overflow-x-auto no-scrollbar shrink-0">
              {getSuggestions().map((sug, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSendMessage(sug)}
                  className="px-2.5 py-1 rounded-full text-[11px] bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 shrink-0 border border-stone-200 dark:border-stone-700 transition-colors cursor-pointer"
                >
                  {sug}
                </button>
              ))}
            </div>
          )}

          {/* FOOTER / INPUT */}
          <footer className="p-3 bg-white dark:bg-stone-900 border-t border-stone-200/80 dark:border-stone-800 shrink-0">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Pregunta sobre productos o servicios..."
                disabled={isLoading}
                className="flex-1 px-3.5 py-2.5 rounded-2xl text-xs bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-100 border border-stone-200 dark:border-stone-700 focus:outline-none focus:ring-2 focus:ring-offset-1 transition-all disabled:opacity-60"
                style={{
                  outlineColor: primaryColor,
                }}
              />
              <button
                type="button"
                onClick={() => handleSendMessage()}
                disabled={!inputValue.trim() || isLoading}
                style={{ backgroundColor: primaryColor }}
                className="p-2.5 rounded-2xl text-white shadow hover:opacity-90 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"
                title="Enviar mensaje"
                aria-label="Enviar mensaje"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[10px] text-stone-400 dark:text-stone-500 px-1 select-none">
              <span>Impulsado por Google Gemini</span>
              <span>Respuestas basadas en el catálogo</span>
            </div>
          </footer>
        </div>
      )}
    </aside>
  );
};
