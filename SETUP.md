# PlateConnect Dashboard - Setup Guide

This project is a vehicle management dashboard with Firebase authentication.

## Features

- **Firebase Authentication**: Secure email/password login and signup
- **Vehicle Tracking Dashboard**: Monitor vehicle arrivals and departures
- **Advanced Filtering**: Filter by person type, status, and date range
- **Responsive Design**: Works on desktop and mobile devices

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

This will install Firebase and all other required dependencies.

### 2. Configure Firebase

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or use an existing one
3. Enable **Email/Password** authentication in Authentication settings
4. Create a Firestore database
5. Copy your project configuration

### 3. Set Environment Variables

1. Copy the `.env.local.example` file to `.env.local`:

```bash
cp .env.local.example .env.local
```

2. Update `.env.local` with your Firebase credentials from the Firebase Console:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
```

### 4. Run Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:3000`

## Project Structure

```
src/
├── app/
│   ├── (auth)/login/page.tsx     # Login page
│   ├── dashboard/page.tsx         # Main dashboard
│   ├── layout.tsx                 # Root layout with auth provider
│   ├── page.tsx                   # Redirect to dashboard
│   └── globals.css                # Global styles
├── context/
│   └── AuthContext.tsx            # Authentication context
lib/
├── firebase.ts                     # Firebase configuration
```

## Usage

### Login

1. Navigate to `/login`
2. Create a new account or login with existing credentials
3. You'll be redirected to the dashboard

### Dashboard Features

- **Person Type Filter**: Filter vehicles by Parent, Student, Staff, or Unknown
- **Status Filter**: Show only Arrived or Left vehicles
- **Date Range**: Filter by arrival date
- **Max Cars Per Page**: Control pagination
- **Log Vehicle Button**: (Ready for implementation) Log new vehicle arrivals
- **Clear Filters**: Reset all filters to default

### Logout

Click the Logout button in the top right to sign out and return to the login page.

## Next Steps

To enhance this dashboard:

1. **Connect to Firestore**: Replace mock data with real database
2. **Log Vehicle Form**: Implement the "Log Vehicle" feature
3. **Image Upload**: Add vehicle image upload to Firebase Storage
4. **Real-time Updates**: Use Firestore listeners for live updates
5. **User Roles**: Add admin/user role management
6. **Export Data**: Add CSV export functionality

## Technologies Used

- **Next.js 15.5** - React framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Firebase** - Authentication and database
- **React Hooks** - State management

## Notes

- All Firebase configuration values are public (prefixed with `NEXT_PUBLIC_`)
- Enable Firestore security rules to protect your data
- Consider implementing Firestore rules for production use
