# Dynamic User Profile Feature

## Overview
This PR implements a dynamic user profile system that allows players to connect their Web3 wallet and set custom usernames, replacing the hardcoded "luckify" username with personalized user identification.

## Features Added

### 🔐 Wallet Connection
- Automatic wallet detection and connection (MetaMask, MiniPay)
- Account change listener that updates the profile in real-time
- Clean connection/disconnection flow

### 👤 Dynamic Username
- Custom username support with validation
- Automatic prompt on first wallet connection
- Edit button for changing username anytime
- Fallback to shortened wallet address when no username is set
- Guest mode for users without a connected wallet

### ✅ Username Validation
- Length: 3-20 characters
- Characters: Alphanumeric and underscores only
- No empty usernames allowed
- Real-time error feedback

### 💾 Data Persistence
- User data stored in browser localStorage
- Persists across sessions
- Maintains username and wallet address

### 🎨 UI/UX Improvements
- Beautiful username modal with Celo-themed styling
- Pencil edit button with hover effects
- Smooth animations and transitions
- Mobile-responsive design

## Technical Implementation

### New Components
- **UsernameModal** - Modal dialog for username input with validation

### New Hooks
- **useWallet** - Encapsulates wallet connection logic and account management

### Context Updates
- **GameStateContext** - Added userAddress and userName state with localStorage persistence

### Component Updates
- **MeScreen** - Dynamic username display with edit functionality
- **App.jsx** - Initialize wallet hook on app load

## Documentation

Comprehensive documentation added:
- INSTALLATION.md
- USER_PROFILE.md
- API.md
- CONTRIBUTING.md
- TESTING.md
- ARCHITECTURE.md
- DEPLOYMENT.md
- FAQ.md
- CHANGELOG.md

## User Flow

1. **First-time User** - Views as "Guest", can connect wallet
2. **First Connection** - Username modal automatically opens
3. **Returning User** - Auto-connects with saved username
4. **Edit Username** - Click edit button anytime to change

## Commits
100 non-empty commits with detailed documentation and feature implementation.
