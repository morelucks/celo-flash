import React, { useState, useEffect, useRef } from 'react';
import { useGameState } from '../context/GameStateContext';
import { playSound } from '../utils/audio';

export default function SavingsCoachDrawer({ isOpen, onClose }) {
  const { 
    savingsGoal, 
    setSavingsGoal, 
    coachMessages, 
    setCoachMessages, 
    cash, 
    soundEnabled 
  } = useGameState();

  const [inputVal, setInputVal] = useState('');
  const messagesEndRef = useRef(null);

  // Scroll to bottom whenever messages or drawer state changes
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [isOpen, coachMessages]);

  // Insert initial greeting if empty
  useEffect(() => {
    if (coachMessages.length === 0) {
      setCoachMessages([
        {
          id: 'greeting',
          sender: 'coach',
          text: "Hello! I am your AI Savings Coach. 🤖 I can help you set and achieve your savings goals. Just tell me something like **'Save $10 for a spawner skin'** to get started!",
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    }
  }, [coachMessages, setCoachMessages]);

  const parseGoal = (text) => {
    // Check for "save $X for Y" or "X for Y" or "save X for Y"
    // Regex matches: save [optional $] [digits] for/buy/to [purpose]
    const saveRegex = /save\s+\$?(\d+(?:\.\d+)?)\s*(?:for|to\s+buy|buy)?\s+(.+)/i;
    const match = text.match(saveRegex);
    if (match) {
      const amount = parseFloat(match[1]);
      const purpose = match[2].trim();
      if (!isNaN(amount) && amount > 0 && purpose.length > 0) {
        return { amount, purpose };
      }
    }

    // Secondary match: just a raw amount and purpose, e.g. "$20 for coffee" or "20 for rent"
    const simpleRegex = /(?:set)?\s*\$?(\d+(?:\.\d+)?)\s*(?:for|to\s+buy|buy)\s+(.+)/i;
    const matchSimple = text.match(simpleRegex);
    if (matchSimple) {
      const amount = parseFloat(matchSimple[1]);
      const purpose = matchSimple[2].trim();
      if (!isNaN(amount) && amount > 0 && purpose.length > 0) {
        return { amount, purpose };
      }
    }

    // Tertiary match: just a number without prefix, e.g., "save 10" or "target 50"
    const amountOnlyRegex = /(?:save|target|goal|need)\s+\$?(\d+(?:\.\d+)?)/i;
    const matchAmountOnly = text.match(amountOnlyRegex);
    if (matchAmountOnly) {
      const amount = parseFloat(matchAmountOnly[1]);
      if (!isNaN(amount) && amount > 0) {
        return { amount, purpose: 'my custom goal' };
      }
    }

    return null;
  };

  const getCoachResponse = (userText) => {
    const textLower = userText.toLowerCase();

    // Check reset
    if (textLower.includes('reset') || textLower.includes('clear') || textLower.includes('delete') || textLower.includes('remove')) {
      setSavingsGoal(null);
      return {
        text: "I've successfully reset your active goal. Tell me when you are ready to set a new one! 🎯",
        action: 'reset'
      };
    }

    // Check progress/status
    if (textLower.includes('progress') || textLower.includes('status') || textLower.includes('how am i doing') || textLower.includes('goal') || textLower.includes('check')) {
      if (savingsGoal && savingsGoal.target > 0) {
        const percentage = Math.min(100, (cash / savingsGoal.target) * 100);
        let msg = `You are currently at **$${cash.toFixed(2)}** of your **$${savingsGoal.target.toFixed(2)}** goal for **${savingsGoal.title}** (${percentage.toFixed(0)}% completed). `;
        if (percentage >= 100) {
          msg += "Amazing job! You have fully reached your goal! 🎉 Go ahead and spend it in the Shop!";
        } else {
          msg += "Keep saving in CeloFlashSavings to accrue yield and watch your balance grow! You've got this! ⚡";
        }
        return { text: msg };
      } else {
        return {
          text: "You don't have an active savings goal set yet! Tell me what you'd like to save for, e.g. **'Save $50 for rent'**."
        };
      }
    }

    // Try parsing goal
    const parsed = parseGoal(userText);
    if (parsed) {
      const newGoal = {
        title: parsed.purpose,
        target: parsed.amount,
        current: cash
      };
      setSavingsGoal(newGoal);
      
      const percentage = Math.min(100, (cash / parsed.amount) * 100);
      let reply = `Awesome! I've set your savings goal: **Save $${parsed.amount.toFixed(2)} for ${parsed.purpose}**. \n\nYou are already **${percentage.toFixed(0)}%** of the way there ($${cash.toFixed(2)} / $${parsed.amount.toFixed(2)})! Keep up the good work! 🚀`;
      return { text: reply, goal: newGoal };
    }

    // Greeting Fallback
    if (textLower.includes('hello') || textLower.includes('hi ') || textLower.startsWith('hi') || textLower.includes('hey')) {
      return {
        text: "Hello! I am your AI Savings Coach. 🤖 Ready to establish a goal? Let me know, e.g., 'Save $10 for a spawner skin'."
      };
    }

    // Generic fallback
    return {
      text: "I didn't quite catch that. I can help you set a savings goal (e.g. **'Save $20 for food'**), check your progress (**'progress'**), or reset your goal (**'reset'**). What would you like to do?"
    };
  };

  const handleSendMessage = (textToSend) => {
    if (!textToSend.trim()) return;

    playSound('click', soundEnabled);
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Add user message
    const userMsg = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: textToSend,
      timestamp
    };

    const updatedMessages = [...coachMessages, userMsg];
    setCoachMessages(updatedMessages);
    setInputVal('');

    // Trigger AI response with typing delay
    setTimeout(() => {
      const coachReplyText = getCoachResponse(textToSend);
      const coachMsg = {
        id: `coach-${Date.now()}`,
        sender: 'coach',
        text: coachReplyText.text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setCoachMessages(prev => [...prev, coachMsg]);
      playSound('message', soundEnabled);
    }, 600);
  };

  const formatText = (text) => {
    // Bold matching
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={idx}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  return (
    <div className={`coach-drawer-overlay ${isOpen ? 'open' : ''}`} onClick={onClose}>
      <div className="coach-drawer" onClick={(e) => e.stopPropagation()}>
        
        {/* Header */}
        <div className="coach-drawer-header">
          <div className="coach-header-info">
            <div className="coach-avatar-circle">🤖</div>
            <div className="coach-header-text">
              <h3>AI Savings Coach</h3>
              <span>
                <span className="coach-status-dot"></span> Online
              </span>
            </div>
          </div>
          <button className="close-drawer-btn" onClick={onClose} aria-label="Close Chat">
            &times;
          </button>
        </div>

        {/* Messages list */}
        <div className="coach-chat-messages">
          {coachMessages.map((msg) => (
            <div key={msg.id} className={`chat-bubble-wrapper ${msg.sender}`}>
              <div className="chat-bubble">
                <p style={{ whiteSpace: 'pre-wrap' }}>{formatText(msg.text)}</p>
                <span className="chat-bubble-time">{msg.timestamp}</span>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick replies */}
        <div className="coach-quick-replies">
          <button className="quick-reply-btn" onClick={() => handleSendMessage("Save $10 for spawner skin")}>
            ⚡ Save $10 for Skin
          </button>
          <button className="quick-reply-btn" onClick={() => handleSendMessage("Save $50 for rent")}>
            🏠 Save $50 for Rent
          </button>
          <button className="quick-reply-btn" onClick={() => handleSendMessage("How is my goal progress?")}>
            📊 Check Progress
          </button>
          <button className="quick-reply-btn" onClick={() => handleSendMessage("Reset my goal")}>
            🔄 Reset Goal
          </button>
        </div>

        {/* Input Bar */}
        <div className="coach-chat-input-bar">
          <input 
            type="text" 
            className="coach-input" 
            placeholder="Type a message..." 
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSendMessage(inputVal);
            }}
          />
          <button className="coach-send-btn" onClick={() => handleSendMessage(inputVal)} aria-label="Send message">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>

      </div>
    </div>
  );
}

// optimize drawer styling tokens for complete test coverage

// refine typing simulator timing to improve mobile UX
