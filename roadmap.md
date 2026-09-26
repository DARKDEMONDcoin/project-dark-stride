# Roadmap
- [x] Telegram bot full parity (menus, history, tasks, approvals, integrations, proposals, decisions, brain, automations, settings)
- [x] Two-way data sync site<->Telegram (shared tables, live refresh, Telegram source badge, instant alerts)
- [ ] Publish latest version to the live address the bot/database point to (needs user to publish)
- [x] توحيد مفاتيح التطبيق بين مخزن الخادم وأسرار التشغيل وإبقاء بيانات ربط المستخدمين مشفّرة
- [x] فصل نص المنشور عن كلام الموظف وبيانات الجدولة ووصف الصورة، وإرسال صورة تيليجرام مع النص دون تكرار
- [x] إزالة النص البديل للصورة من المنشورات + فحص كل أزرار البوت (إصلاح زر "القائمة الكاملة")
- [x] محرك المبادرات: إشارات لكل الموظفين الستة (فشل نشر، منشور بلا صورة، تكامل منقطع، CRM خامل، مراجعة أسبوعية، فحص الأرقام)
- [x] المتصفح السحابي بموافقات ولقطات شاشة قبل التنفيذ وبعده في الموقع وTelegram
- [ ] مبادرات وأدوات كل موظف + صفحة المبادرات والقياس (المرحلتان 3 و4)

- [x] مراجعة مصادر مفاتيح المنصة المتاحة وإصلاح مسار المتصفح واختباره حياً

- [ ] ربط أسرار Supabase Functions بالموقع — محظور تقنياً لأن Supabase لا يسمح بقراءة قيم الأسرار بعد حفظها، والموقع يعمل في خادم مستقل؛ يلزم حفظها أيضاً في Runtime Secrets أو نقل العمليات المستهلكة إلى Functions.
