package com.estradox.app

import android.app.Application
import com.estradox.app.data.Api
import com.estradox.app.data.Session
import com.estradox.app.notify.NoticeWorker
import com.estradox.app.notify.Notifier

class EstradoxApp : Application() {
    lateinit var session: Session
        private set
    lateinit var api: Api
        private set

    override fun onCreate() {
        super.onCreate()
        session = Session(this)
        api = Api(session)
        Notifier.createChannels(this)
        if (session.token != null) NoticeWorker.schedule(this)
    }
}
