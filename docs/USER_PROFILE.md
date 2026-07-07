# User Profile Feature

## Overview

The user profile feature provides dynamic user identification based on wallet connection.


## Features

### Wallet Connection

Users can connect their Web3 wallet (MetaMask, MiniPay) to the application.


### Dynamic Username

Players can set a custom username that displays on their profile.

If no username is set, the profile displays the shortened wallet address.


### Edit Username


An edit button appears next to the username when connected.
Clicking the edit button opens a modal for username changes.


### Local Storage


User data persists across sessions using browser localStorage.


## Technical Implementation


### Context Management


User state is managed through GameStateContext.
The context stores userAddress and userName state.


### Wallet Hook


The useWallet hook manages Web3 wallet connections.
