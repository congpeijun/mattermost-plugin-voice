import request from 'superagent';
import {Client4} from 'mattermost-redux/client';

import {id as pluginId} from '../manifest';

import Recorder from './recorder.js';

export default class Client {
    constructor(siteURL) {
        this._onUpdate = null;
        this.timerID = null;
        this.recorder = new Recorder({
            workerURL: `${siteURL}/plugins/${pluginId}/public/recorder.worker.js`,
        });
        request.get(`${siteURL}/plugins/${pluginId}/config`).accept('application/json').then((res) => {
            this.recorder.init({
                maxDuration: parseInt(res.body.VoiceMaxDuration, 10),
                bitRate: parseInt(res.body.VoiceAudioBitrate, 10),
            }).then(() => {
                // console.log('client: recorder initialized');
            });
        });
        this.recorder.on('maxduration', () => {
            if (this.timerID) {
                clearInterval(this.timerID);
            }
            this.recorder.stop().then((recording) => {
                this._recording = recording;
                if (this._onUpdate) {
                    this._onUpdate(0);
                }
            });
        });
    }

    startRecording(channelId, rootId) {
        // console.log('client: start recording');
        this.channelId = channelId || null;
        this.rootId = rootId || null;
        this._recording = null;
        return this.recorder.start().then(() => {
            this.timerID = setInterval(() => {
                if (this._onUpdate && this.recorder.startTime) {
                    this._onUpdate(new Date().getTime() - this.recorder.startTime);
                }
            }, 200);
        });
    }

    stopRecording() {
        // console.log('client: stop recording');
        if (this.timerID) {
            clearInterval(this.timerID);
        }
        this._onUpdate = null;
        return this.recorder.stop();
    }

    cancelRecording() {
        // console.log('client: cancel recording');
        if (this.timerID) {
            clearInterval(this.timerID);
        }
        this._onUpdate = null;
        return this.recorder.cancel();
    }

    _sendRecording({channelId, rootId, recording}) {
        const filename = `${new Date().getTime() - recording.duration}.mp3`;

        return request.
            post(Client4.getFilesRoute()).
            set(Client4.getOptions({method: 'post'}).headers).
            attach('files', recording.blob, filename).
            field('channel_id', channelId).
            accept('application/json').then((res) => {
                const data = {
                    channel_id: channelId,
                    root_id: rootId,
                    message: 'Voice Message',
                    type: 'custom_voice',
                    props: {
                        fileId: res.body.file_infos[0].id,
                        duration: recording.duration,
                    },
                };
                return request.post(Client4.getPostsRoute()).
                    set(Client4.getOptions({method: 'post'}).headers).
                    send(data).
                    accept('application/json');
            });
    }

    sendRecording(channelId, rootId) {
        if (!this.channelId && !channelId) {
            return Promise.reject(new Error('channel id is required'));
        }
        const cId = this.channelId ? this.channelId : channelId;
        const rId = !this.channelId && rootId ? rootId : this.rootId;
        // console.log('client: send recording');
        if (this._recording) {
            return this._sendRecording({
                channelId: cId,
                rootId: rId,
                recording: this._recording,
            });
        }
        return this.recorder.stop().then((res) => {
            return this._sendRecording({
                channelId: cId,
                rootId: rId,
                recording: res,
            });
        });
    }

    on(type, cb) {
        if (type === 'update') {
            this._onUpdate = cb;
        }
    }
}
