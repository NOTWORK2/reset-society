# Reset Society — Website

موقع ثابت (HTML/CSS/JS بدون build) + Firebase (Firestore + Authentication) للحجوزات ولوحة التحكم.

## الصفحات
| الصفحة | الوظيفة |
|---|---|
| `index.html` | الرئيسية: Hero، الخدمات، The Ritual، الموقع والتواصل |
| `book.html` | الحجز بخمس خطوات: الخدمة ← التاريخ والوقت ← البيانات ← الدفع ← التأكيد |
| `admin.html` | لوحة التحكم (محمية بتسجيل دخول) |

## الملفات المهمة
- `js/config.js`: الأسعار والمدد وأوقات الحجز وأيام الإغلاق الأسبوعية ورقم واتساب وإنستغرام وساعات العمل والعنوان، وكذلك `capacity` (عدد الزبائن في نفس الوقت لكل خدمة). القيم المكتوب بجانبها `TODO` مؤقتة.
- `js/firebase-config.js`: إعدادات مشروع Firebase.
- `firestore.rules`: قواعد الحماية. **إذا غيّرت `capacity` أو أضفت خدمة في config.js فعدّلها هنا أيضاً.**

## وضعا التشغيل
- **بدون Firebase** (`projectId` فارغ): الحجز يُرسل للمحل كرسالة واتساب، وصفحة التأكيد تقول "Booking Received".
- **مع Firebase**: الحجز يُحفظ فوراً، والوقت يُقفل للباقين، وصفحة التأكيد تقول "Booking Confirmed" كما في التصميم. يظهر الحجز للمالك في لوحة التحكم مباشرة.

## إعداد Firebase (مرة واحدة)
1. أنشئ مشروعاً في [Firebase Console](https://console.firebase.google.com/) باسم الزبون.
2. **Build ← Firestore Database ← Create database**، واختر منطقة قريبة (مثل `europe-west` أو `me-central`).
3. **Build ← Authentication ← Get started**، ثم فعّل:
   - **Email/Password**: لحساب المالك.
   - **Anonymous**: ضروري، فالزبائن يُسجَّلون كمجهولين حتى يُسمح لهم بالحجز.
4. **Authentication ← Users ← Add user**: أنشئ بريد المالك وكلمة مروره، ثم انسخ **User UID**.
5. **Firestore ← Start collection** باسم `admins`، واجعل **Document ID** هو الـ UID المنسوخ (أضف أي حقل، مثل `name: owner`).
6. **Project settings ← Your apps ← Web (</>)**: سجّل تطبيقاً، ثم انسخ `apiKey` و`authDomain` و`projectId` و`appId` إلى `js/firebase-config.js`.
7. انشر قواعد الحماية من مجلد `site`:
   ```
   npm install -g firebase-tools
   firebase login
   firebase use --add        (اختر المشروع)
   firebase deploy --only firestore:rules
   ```
   ⚠️ بدون هذه الخطوة تبقى قاعدة البيانات مقفلة، أو مفتوحة للجميع إذا اخترت test mode.
8. افتح `admin.html` وسجّل الدخول ببريد المالك.

> يمكن أيضاً استضافة الموقع على Firebase Hosting: `firebase deploy` (ملف `firebase.json` جاهز). أو استخدم GitHub Pages كما في مشروعك السابق.

## كيف يعمل منع الحجز المزدوج
كل حجز يُنشأ معه مستند في `slotLocks` معرّفه `التاريخ_الوقت_الخدمة_رقم`، في عملية واحدة. قواعد الحماية ترفض العملية إذا كان المكان محجوزاً، وترفض أيضاً: تجاوز السعة، والحجز في الماضي أو في يوم مغلق، وادعاء الدفع أونلاين، وقراءة حجوزات الآخرين. `slotLocks` عامة لكن لا تحتوي بيانات شخصية.

## لوحة التحكم
- حجوزات اليوم / القادمة / السابقة، مع بحث بالاسم أو الهاتف أو الرقم المرجعي، وتحديث مباشر وإشعار عند وصول حجز جديد.
- أزرار: واتساب للزبون، **Done**، **No-show**، **Cancel** (الإلغاء يحرر الوقت).
- **Schedule**: عرض كل وقت في يوم معين، مع **Block** لإيقاف الحجز في وقت معين، و**Closed all day** لإغلاق يوم كامل.
- **+ New booking**: لإضافة حجوزات الهاتف أو الزبائن الذين يحضرون مباشرة (يمنع التعارض أيضاً).

## الصور
الصور في `assets/img` مقصوصة من التصاميم (دقة منخفضة). استبدلها بصور المحل الحقيقية بنفس الأسماء.

## تشغيل محلي
```
python -m http.server 8000 --directory site
```
للتجربة بدون مشروع حقيقي: ضع `projectId: "demo-reset"` و`apiKey: "demo-key"` في `firebase-config.js`، ثم شغّل `firebase emulators:start --project demo-reset` من مجلد `site` (المحاكي يعمل على المنفذين 9099 و8085). لا تنسَ إرجاع الإعدادات قبل الرفع.
